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
  // John Smith Jr is a FULL 1:1 mirror of Patient Zero — his DB record is an
  // exact clone (scripts/clone-joao-to-john.mjs) and his frontend is Joao's
  // static HTML re-skinned in place by assets/john-mode.js (name swap + force
  // pt). Like Leo he takes Patient Zero's bespoke static path here.
  var JOHN_SMITH_JR   = 'pending:john-smith-jr-9d4e21';

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
  /* Proxy views (viewer !== patient) must carry ?patient= in the URL so the
     worker's static gate can enforce per-grant routing (view_mode='scroll'
     302s nav pages to /consult). When the patient was resolved only from
     sessionStorage, canonicalize it into the URL once. Self-view skips the
     extra hop — the pin never applies to it. */
  var viewerClerkEarly = '';
  try { viewerClerkEarly = sessionStorage.getItem('jc_viewer_clerk') || ''; } catch (_) {}
  if (!fromUrl && viewerClerkEarly && viewerClerkEarly !== patient) {
    params.set('patient', patient);
    location.replace(location.pathname + '?' + params.toString() + location.hash);
    return;
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

  /* ── View-mode toggle (topnav, left of the language flags) ──────────
     Every record has two experiences: 'navigation' (the multi-page app)
     and 'scroll' (/consult — one continuous page). The active side is
     whichever page type is open right now. Switching persists before it
     navigates: granted viewers write their own grant's view_mode via
     /api/access/view-mode (the picker and the worker's scroll pin then
     land them on the chosen mode at every later login, until they switch
     again — the admin-set value is only the default); self/admin viewers
     have no grant row, so their preference lives in localStorage and the
     picker reads it from there. */
  function injectViewToggle() {
    var host = document.querySelector('.topnav .lang-switch');
    if (!host || host.querySelector('.viewmode-btn')) return;

    if (!document.getElementById('jc-viewmode-css')) {
      var css = document.createElement('style');
      css.id = 'jc-viewmode-css';
      // Mirrors .lang-btn (the flags immediately to the right) so the two
      // controls read as one family; kept inline-injected so no styles.css
      // version bump is needed on the static shells.
      css.textContent =
        '.viewmode-btn{background:transparent;border:1.5px solid rgba(255,255,255,0.18);' +
          'border-radius:4px;padding:0;width:30px;height:21px;cursor:pointer;color:#fff;' +
          'opacity:0.55;display:inline-flex;align-items:center;justify-content:center;' +
          'transition:border-color 0.15s,opacity 0.15s}' +
        '.viewmode-btn:hover{opacity:0.85}' +
        '.viewmode-btn[aria-pressed="true"]{border-color:#fff;opacity:1;cursor:default;' +
          'box-shadow:0 0 0 1.5px rgba(255,255,255,0.25)}' +
        '.viewmode-btn svg{display:block}';
      document.head.appendChild(css);
    }

    var mode = currentSection() === 'consult' ? 'scroll' : 'navigation';

    function switchTo(target) {
      if (target === mode) return;
      var headers = { 'Content-Type': 'application/json' };
      var vc = '';
      try { vc = sessionStorage.getItem('jc_viewer_clerk') || ''; } catch (_) {}
      if (vc) headers['X-Viewer-Clerk'] = vc;
      // Persist BEFORE navigating: the worker's static gate 302s a
      // scroll-granted viewer off every nav page, so the grant row must
      // already say 'navigation' when the next page loads. A network
      // failure still navigates (the gate re-pins, never breaks), but an
      // explicit 400 means the server refused the pin because /consult
      // can render nothing for this grant — stay put instead of landing
      // the viewer on a guaranteed-blank page.
      fetch('/api/access/view-mode', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ patient: patient, view_mode: target }),
      }).then(
        function (r) {
          return r.json().then(
            function (b) { return { status: r.status, body: b }; },
            function () { return { status: r.status, body: null }; }
          );
        },
        function () { return { status: 0, body: null }; }
      ).then(function (res) {
        if (res.status === 400) {
          alert(tPlain(
            'The scroll view has nothing to display for this record with your access level.',
            'A visão de rolagem não tem o que exibir neste prontuário com o seu nível de acesso.'
          ));
          return;
        }
        // Self/admin viewers have no grant row to carry the choice — keep
        // it client-side, namespaced by VIEWER + patient so one account's
        // preference can never route another account on a shared browser.
        if (vc && res.body && res.body.persisted === 'none') {
          try { localStorage.setItem('jc_view_pref:' + vc + ':' + patient, target); } catch (_) {}
        }
        var page = target === 'scroll' ? 'consult.html' : 'home.html';
        var qs = 'patient=' + encodeURIComponent(patient);
        // Preserve ?viewer= so the curl/headless clerk-as-identity flow (no
        // cookie) survives the hop — same as the worker's scroll-pin redirect.
        var v = new URLSearchParams(location.search).get('viewer');
        if (v) qs += '&viewer=' + encodeURIComponent(v);
        location.href = page + '?' + qs;
      });
    }

    function makeBtn(value, svg, en, pt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'viewmode-btn';
      b.setAttribute('data-viewmode', value);
      b.setAttribute('aria-pressed', String(mode === value));
      var label = tPlain(en, pt);
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = svg;
      b.addEventListener('click', function () { switchTo(value); });
      return b;
    }

    // Navigation: pillar pages behind a topnav. Scroll: one long page.
    var navBtn = makeBtn('navigation',
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
      'Navigation view — pages', 'Visão de navegação — páginas');
    var scrollBtn = makeBtn('scroll',
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="20"/><polyline points="8 8 12 4 16 8"/><polyline points="8 16 12 20 16 16"/></svg>',
      'Scroll view — single page', 'Visão de rolagem — página única');

    // "To the left of the flags": before the first flag button; falls back
    // to appending when a shell has no flags (defensive only).
    var firstFlag = host.querySelector('.lang-btn');
    if (firstFlag) {
      host.insertBefore(navBtn, firstFlag);
      host.insertBefore(scrollBtn, firstFlag);
    } else {
      host.appendChild(navBtn);
      host.appendChild(scrollBtn);
    }
  }

  function hidePageBody() {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      // Keep <nav> (the top bar) and <script>; explicitly hide
      // <header class="page-header"> because it hardcodes Joao's hero
      // copy on the static pages and would leak through for every
      // other patient. Patient content renders INSIDE the assembler
      // root (.lumen-page-root) — no per-patient classes here (I-2).
      if (el.tagName === 'NAV' || el.tagName === 'SCRIPT' ||
          el.classList.contains('lumen-page-root') ||
          el.classList.contains('lumen-chat-root') ||
          el.classList.contains('jc-danger-zone') ||
          el.classList.contains('jc-danger-backdrop')) continue;
      el.style.display = 'none';
    }
  }

  /* Canon: a pillar with no data shows no nav entry (and no home pillar card).
     The topnav (Physical / Mental / Spiritual) is static HTML shared by every
     page, so gate it here from the patient's real pillar totals. Fail-open:
     hides a pillar ONLY when the summary explicitly reports total === 0, so a
     missing/errored summary never strips a populated nav. Not called for the
     static-HTML patients (Joao / Leo) — their curated nav is left intact. */
  function gatePillarNav(clerkId) {
    if (!clerkId) return;
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(clerkId), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        var P = s && s.pillars;
        if (!P) return;
        ['physical', 'mental', 'spiritual'].forEach(function (k) {
          if (!P[k] || P[k].total > 0) return; // unknown or has data -> keep
          var href = k + '.html';
          document.querySelectorAll('.topnav-links a[href="' + href + '"]').forEach(function (a) {
            var li = a.closest('li'); if (li) li.style.display = 'none';
          });
          document.querySelectorAll('.entry-card[href="' + href + '"]').forEach(function (c) {
            c.style.display = 'none';
          });
        });
      })
      .catch(function () {});
  }

  // ─── Renderers ──────────────────────────────────────────────────


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
      '<div class="section-label"><span class="lang-en">Treatment</span><span class="lang-pt">Tratamento</span></div>' +
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

  /* ── Home topic-section builders (assembler providers) ──────────────
     The old renderHome() hero + mount is retired: the assembler owns the
     hero (identity from /api/patient-summary, nullable-safe) and the page
     sequence. These builders return topic-section HTML only.            */
  function homeReportsNavHtml(summary) {
    // ── Reports — pillar cards, one per pillar THAT HAS DATA ─────────
    // Canon: a pillar with no data shows no pillar card (and no nav entry —
    // see gatePillarNav). Gate each card on summary.pillars[x].total so a
    // labs-only patient (e.g. Hercio) shows only Physical, never empty
    // Mental/Spiritual cards that lead to blank pages.
    var PILLARS = (summary && summary.pillars) || {};
    function pillarHasData(k) { return !!(PILLARS[k] && PILLARS[k].total > 0); }
    var physicalCard = !pillarHasData('physical') ? '' :
            '<a class="entry-card entry-card-visual" href="physical.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M32 54 L13 36 C7 30 7 22 13 18 C18 13 25 13 29 18 L32 21 L35 18 C39 13 46 13 51 18 C57 22 57 30 51 36 L32 54 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<polyline points="6,36 18,36 22,28 27,44 32,30 37,38 42,36 58,36" stroke="#3E7CA3" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Physical Health Overview</span><span class="lang-pt">Visão geral da saúde física</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>';
    var mentalCard = !pillarHasData('mental') ? '' :
            '<a class="entry-card entry-card-visual" href="mental.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M32 14 C22 14 14 20 14 30 C14 40 22 50 32 50 V14 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M32 14 C42 14 50 20 50 30 C50 40 42 50 32 50 V14 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M22 24 Q26 26 22 30 Q26 34 22 38" stroke="#3E7CA3" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
                '<path d="M42 24 Q38 26 42 30 Q38 34 42 38" stroke="#3E7CA3" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Mental Health Overview</span><span class="lang-pt">Visão geral da saúde mental</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>';
    var spiritualCard = !pillarHasData('spiritual') ? '' :
            '<a class="entry-card entry-card-visual" href="spiritual.html">' +
              '<svg class="entry-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<path d="M27 8 L37 8 L37 22 L50 22 L50 32 L37 32 L37 56 L27 56 L27 32 L14 32 L14 22 L27 22 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2" stroke-linejoin="round"/>' +
                '<line x1="32" y1="14" x2="32" y2="54" stroke="#3E7CA3" stroke-width="2" stroke-linecap="round"/>' +
                '<line x1="18" y1="27" x2="46" y2="27" stroke="#3E7CA3" stroke-width="2" stroke-linecap="round"/>' +
              '</svg>' +
              '<div class="entry-title"><span class="lang-en">Spiritual Health Overview</span><span class="lang-pt">Visão geral da saúde espiritual</span></div>' +
              '<span class="entry-cta"><span class="lang-en">Open</span><span class="lang-pt">Abrir</span></span>' +
            '</a>';
    var pillarCards = physicalCard + mentalCard + spiritualCard;
    if (!pillarCards) return '';
    return '<section class="report-section">' +
        '<div class="container">' +
          '<div class="section-label"><span class="lang-en">Browse</span><span class="lang-pt">Navegar</span></div>' +
          '<h2 class="section-title"><span class="lang-en">Reports</span><span class="lang-pt">Relatórios</span></h2>' +
          '<div class="entry-grid entry-grid-visual">' +
            pillarCards +
          '</div>' +
        '</div>' +
      '</section>';
  }

  /* At-a-glance: per-pillar record counts from summary.pillars breakdowns.
     Renders only pillars with total > 0 (G-NUM per card, contract I-5). */
  function homeAtAGlanceHtml(summary) {
    var P = (summary && summary.pillars) || {};
    var LBL = {
      lab_results: ['lab markers', 'marcadores'], imaging_studies: ['imaging studies', 'exames de imagem'],
      medications: ['medications', 'medicações'], supplements: ['supplements', 'suplementos'],
      encounters: ['encounters', 'consultas'], prescriptions: ['prescriptions', 'prescrições'],
      vitals_days: ['vitals days', 'dias de vitais'], ecg_events: ['ECG events', 'eventos de ECG'],
      pgx_findings: ['PGx findings', 'achados PGx'], writings: ['writings', 'escritos'],
      mood_entries: ['mood entries', 'registros de humor'], psych_items: ['psych items', 'itens psiquiátricos'],
      panic_events: ['panic events', 'eventos de pânico'], risk_assessments: ['risk assessments', 'avaliações de risco'],
      therapy_sessions: ['therapy sessions', 'sessões de terapia'],
      wheel_of_life: ['wheel of life', 'roda da vida'], life_events: ['life events', 'eventos de vida'],
      sleep_studies: ['sleep studies', 'estudos do sono'], edx_studies: ['EDX studies', 'estudos EDX'],
    };
    var PILLAR_LBL = { physical: ['Physical', 'Físico'], mental: ['Mental', 'Mental'], spiritual: ['Spiritual', 'Espiritual'] };
    var cards = ['physical', 'mental', 'spiritual'].map(function (k) {
      var pl = P[k];
      if (!pl || !(pl.total > 0)) return '';
      var bits = Object.keys(pl.breakdown || {}).filter(function (b) {
        return Number(pl.breakdown[b]) > 0;
      }).map(function (b) {
        var l = LBL[b] || [b.replace(/_/g, ' '), b.replace(/_/g, ' ')];
        return '<li>' + pl.breakdown[b] + ' ' + t(escapeHtml(l[0]), escapeHtml(l[1])) + '</li>';
      }).join('');
      return '<div class="glance-card">' +
        '<div class="glance-pillar">' + t(PILLAR_LBL[k][0], PILLAR_LBL[k][1]) + '</div>' +
        '<div class="glance-total">' + pl.total + '</div>' +
        (bits ? '<ul class="glance-bits">' + bits + '</ul>' : '') +
      '</div>';
    }).join('');
    if (!cards) return '';
    injectGlanceStyles();
    return '<section class="report-section"><div class="container">' +
      '<div class="section-label"><span class="lang-en">At a glance</span><span class="lang-pt">Resumo rápido</span></div>' +
      '<h2 class="section-title"><span class="lang-en">Records on file</span><span class="lang-pt">Registros no prontuário</span></h2>' +
      '<div class="glance-grid">' + cards + '</div>' +
    '</div></section>';
  }
  function injectGlanceStyles() {
    if (document.getElementById('jc-glance-styles')) return;
    var s = document.createElement('style');
    s.id = 'jc-glance-styles';
    s.textContent =
      '.glance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;}' +
      '.glance-card{background:var(--surface-pure,#FFF);border:1px solid var(--border-subtle,#E5E2DC);border-radius:10px;padding:18px 20px;}' +
      '.glance-pillar{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted,#7A8FA6);}' +
      '.glance-total{font-family:Raleway,sans-serif;font-weight:300;font-size:32px;color:var(--text-primary,#0D1B2A);margin:4px 0 8px;}' +
      '.glance-bits{list-style:none;margin:0;padding:0;font-size:13px;color:var(--text-secondary,#3E4956);}' +
      '.glance-bits li{margin:2px 0;}';
    document.head.appendChild(s);
  }

  /* Injuries & surgeries from summary.procedures (same rows the static
     Patient-Zero tables use via decorateProceduresFromDb).             */
  function homeInjuriesHtml(summary) {
    var rows = (summary && summary.procedures) || [];
    if (!rows.length) return '';
    var injuries = rows.filter(function (r) { return (r.type || '').toLowerCase() === 'injury'; });
    var surgeries = rows.filter(function (r) { return (r.type || '').toLowerCase() !== 'injury'; });
    function tbl(titleEn, titlePt, list) {
      if (!list.length) return '';
      return '<section class="exam-panel">' +
        '<div class="exam-panel-head">' +
          '<h2>' + t(titleEn, titlePt) + '</h2>' +
          '<span class="exam-panel-count">' + list.length + '</span>' +
        '</div>' +
        '<table class="exam-table"><thead><tr>' +
          '<th>' + t('Date', 'Data') + '</th><th>' + t('Event', 'Evento') + '</th>' +
          '<th>' + t('Location', 'Local') + '</th><th>' + t('Notes', 'Observações') + '</th>' +
        '</tr></thead><tbody>' + list.map(procRow).join('') + '</tbody></table>' +
      '</section>';
    }
    return '<section class="report-section"><div class="container">' +
      '<div class="section-label"><span class="lang-en">Cross-cutting context</span><span class="lang-pt">Contexto transversal</span></div>' +
      '<h2 class="section-title"><span class="lang-en">Injury &amp; surgical history</span><span class="lang-pt">Histórico de lesões e cirurgias</span></h2>' +
      tbl('Injuries', 'Lesões', injuries) +
      tbl('Surgeries & procedures', 'Cirurgias e procedimentos', surgeries) +
    '</div></section>';
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

  // Paulo's pain-map as a registry section (home, patient-scoped): pure
  // builder — the assembler owns its placement in the page order.
  function buildPauloPainMapSection() {
    injectPauloPainMapStyles();
    var sec = document.createElement('section');
    sec.id = 'paulo-painmap';
    sec.className = 'report-section paulo-painmap-section';
    sec.innerHTML = renderPauloPainMap();
    return sec;
  }

  function fmtLabNum(n) {
    if (n == null || !isFinite(n)) return '';
    var abs = Math.abs(Number(n));
    var s = (abs >= 1000) ? Number(n).toFixed(0)
          : (abs >= 100)  ? Number(n).toFixed(1)
          :                  Number(n).toFixed(2);
    // Strip trailing zeros ONLY after a decimal point — the old /\.?0+$/
    // (optional dot) truncated round integers: 1250 -> "125", 1500 -> "15".
    return s.indexOf('.') === -1 ? s : s.replace(/0+$/, '').replace(/\.$/, '');
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
      ? ' role="button" tabindex="0" aria-haspopup="dialog"' +
        ' aria-label="' + tPlain('Click to view exam history', 'Clique para ver o histórico do exame') + '"'
      : '';
    return (
      '<div class="' + cardCls + '"' + attrs + '>' +
        '<div class="lab-test-head">' +
          '<div class="lab-test-name">' + (m.marker_html || escapeHtml(m.marker)) + '</div>' +
          '<div class="lab-test-meta">' +
            '<span class="lab-test-val">' + valHtml + '</span>' +
            /* m.no_ref: this metric has NO reference range at all, so there is
               no in/out-of-range verdict to show. classifyLab() falls back to
               'normal' when refs are absent, which would render a green
               "Normal" chip asserting a judgement the data cannot support
               (e.g. a raw body weight in kg). Undefined for every existing
               caller -> pill renders exactly as before. */
            (m.no_ref ? '' : '<span class="pill ' + pillCls + '">' + pillLabel(status, m.flag) + '</span>') +
            historyBadge +
          '</div>' +
        '</div>' +
        renderLabBar(value, m.ref_low, m.ref_high, status) +
        /* no_ref also suppresses the reference line: "Reference: —" is noise
           for a metric that has no range to compare against. */
        ((m.no_ref && !subline) ? '' :
          '<div class="lab-test-foot">' +
            (m.no_ref ? '' : '<div class="lab-test-ref">' + t('Reference:', 'Referência:') + ' ' + formatRefText(m.ref_low, m.ref_high, m.unit) + '</div>') +
            subline +
          '</div>') +
        renderLabHistory(m) +
      '</div>'
    );
  }

  // Direction of an out-of-range value: 'H' | 'L' | '' — used both to color
  // the popup chart's dots and to keep the history pills honest when the
  // source carried no explicit flag.
  function labFlagDir(v, refLow, refHigh, flag) {
    if (flag === 'H' || flag === 'HH' || flag === 'high') return 'H';
    if (flag === 'L' || flag === 'LL' || flag === 'low')  return 'L';
    if (v == null || !isFinite(v)) return '';
    if (refHigh != null && isFinite(refHigh) && v > refHigh) return 'H';
    if (refLow  != null && isFinite(refLow)  && v < refLow)  return 'L';
    return '';
  }

  // Per-card sample history. Renders one row per sample in m.points
  // (Date · Requested by · Result · Status pill) — newest first, latest row
  // highlighted. Empty string when there's only one sample. The block stays
  // hidden in the card: it is the DATA CARRIER for the history popup
  // (openLabPopup scrapes its rows + the data-* attrs below), which
  // installLabHistoryHandler() opens on card click.
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
      var isoDate = p.taken_at ? String(p.taken_at).slice(0, 10) : '';
      var dataAttrs =
        ' data-date="' + escapeHtml(isoDate) + '"' +
        (v != null ? ' data-value="' + v + '"' : '') +
        ' data-flag="' + labFlagDir(v, m.ref_low, m.ref_high, p.flag) + '"';
      var latestAttr = i === 0 ? ' data-latest="' + tPlain('latest', 'mais recente') + '"' : '';
      return (
        '<tr class="' + rowCls + '"' + dataAttrs + '>' +
          '<td class="lab-hist-date"' + latestAttr + '>' + escapeHtml(dateStr) + '</td>' +
          '<td class="lab-hist-doctor">' + requested + '</td>' +
          '<td class="lab-hist-val">' + escapeHtml(valStr) + unit + '</td>' +
          '<td class="lab-hist-status"><span class="pill ' + pillCls + '">' + pillLabel(status, p.flag) + '</span></td>' +
        '</tr>'
      );
    }).join('');
    var refAttrs =
      (m.ref_low  != null && isFinite(m.ref_low)  ? ' data-ref-low="'  + m.ref_low  + '"' : '') +
      (m.ref_high != null && isFinite(m.ref_high) ? ' data-ref-high="' + m.ref_high + '"' : '') +
      (m.unit ? ' data-unit="' + escapeHtml(m.unit) + '"' : '');
    return (
      '<div class="lab-test-history" aria-hidden="true"' + refAttrs + '>' +
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
  // "8 Jun 2026" (the static comparison table's authoring format) -> ISO.
  var CMP_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                     jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseCmpDate(s) {
    var m = String(s || '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
    if (!m) return '';
    var mo = CMP_MONTHS[m[2].toLowerCase()];
    if (!mo) return '';
    return m[3] + '-' + pad(mo) + '-' + pad(+m[1]);
  }

  // Static-table numbers are EN-formatted ("1,250.8"); qualitative results
  // ("Negative", "< 0.01") stay table-only. Returns a Number or null.
  function parseCmpNum(raw) {
    var t = String(raw || '').replace(/,/g, '').replace(/^[<>≤≥]\s*/, '').trim();
    if (!/^-?[\d.]+$/.test(t)) return null;
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // pt-BR-formatted bounds on the static cards ("0,7" / "1.250,8") -> Number.
  function parsePtNum(raw) {
    var t = String(raw || '').trim();
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // Reference bounds for a static .lab-test card: the bar labels are the
  // machine-friendly source ("min 0,7" / "max 1,2"); the free-text
  // reference line is the fallback ("0,70 a 1,20 mg/dL", "Superior a 60",
  // "< 150"). One-sided ranges are normal (eGFR, cholesterol).
  function parseCardRefs(card) {
    var lo = null, hi = null;
    card.querySelectorAll('.lab-bar-labels span').forEach(function (span) {
      var tx = span.textContent || '';
      var mLo = tx.match(/(?:min|mín)\.?\s*([\d.,]+)/i);
      var mHi = tx.match(/(?:max|máx)\.?\s*([\d.,]+)/i);
      if (mLo) lo = parsePtNum(mLo[1]);
      if (mHi) hi = parsePtNum(mHi[1]);
    });
    if (lo == null && hi == null) {
      var refEl = card.querySelector('.lab-test-ref');
      var tx2 = refEl ? (refEl.textContent || '') : '';
      // (?!h) rejects clock ranges ("07–09h: 6,0 a 18,4") so the real
      // numeric range after them is the one that matches.
      var range = tx2.match(/([\d.,]+)\s*(?:a|to|–|—)\s*([\d.,]+)(?!h)/i);
      var sup = tx2.match(/(?:superior a|acima de|maior que|>)\s*([\d.,]+)/i);
      var inf = tx2.match(/(?:inferior a|abaixo de|menor que|até|<)\s*([\d.,]+)/i);
      // Banded texts lead with the intended limit ("Ótimo: <100;
      // Desejável: 100–129; …") — when a one-sided bound appears BEFORE
      // the first range, the range is a later band, not the reference
      // (an LDL of 95 must never flag Low against "100–129").
      var oneSided = [sup, inf].filter(Boolean).sort(function (a, b) { return a.index - b.index; })[0] || null;
      if (range && (!oneSided || range.index < oneSided.index)) {
        lo = parsePtNum(range[1]);
        hi = parsePtNum(range[2]);
      } else {
        if (sup) lo = parsePtNum(sup[1]);
        if (inf) hi = parsePtNum(inf[1]);
      }
    }
    return { lo: lo, hi: hi };
  }

  function retrofitStaticLabHistory() {
    var cmpTable = document.querySelector('.lab-cmp-table');
    if (!cmpTable) return;

    // ── 1. Read column metadata from <thead> ─────────────────────
    var colHeaders = cmpTable.querySelectorAll('thead .lab-cmp-col-head');
    // Lab/doctor header cells can carry bilingual .lang-en/.lang-pt pairs
    // ("Self-administered"/"Autoaplicado") — keep those as trusted static
    // markup so the CSS language switch keeps working; textContent would
    // concatenate both languages.
    function colText(el) {
      if (!el) return '';
      return el.querySelector('.lang-en, .lang-pt')
        ? { html: el.innerHTML }
        : el.textContent.trim();
    }
    var cols = [];
    colHeaders.forEach(function (th) {
      var d = th.querySelector('.lab-cmp-date');
      cols.push({
        date: d ? d.textContent.trim() : '',
        lab: colText(th.querySelector('.lab-cmp-lab')),
        doctor: colText(th.querySelector('.lab-cmp-md')),
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
          iso: parseCmpDate(col.date),
          lab: col.lab,
          doctor: col.doctor,
          value: raw,
          num: parseCmpNum(raw),
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

      // Reference bounds come from the card itself — the comparison table
      // carries no per-cell flags, so each historical value is classified
      // against them (old out-of-range results used to all read "Normal").
      var refs = parseCardRefs(card);

      var rowsHtml = samples.map(function (s, i) {
        var rowCls = 'lab-hist-row' + (i === 0 ? ' is-latest' : '');
        var dir = labFlagDir(s.num, refs.lo, refs.hi, s.flag);
        var pillCls, pillLabel;
        if (dir === 'H') {
          pillCls = 'pill-flag';
          pillLabel = '<span class="lang-en">High</span><span class="lang-pt">Alto</span>';
        } else if (dir === 'L') {
          pillCls = 'pill-flag';
          pillLabel = '<span class="lang-en">Low</span><span class="lang-pt">Baixo</span>';
        } else {
          pillCls = 'pill-ok';
          pillLabel = '<span class="lang-en">Normal</span><span class="lang-pt">Normal</span>';
        }
        function colHtml(c) { return (c && c.html != null) ? c.html : escapeHtml(c); }
        function colEmpty(c) {
          var tx = (c && c.html != null) ? c.html.replace(/<[^>]*>/g, '').trim() : String(c || '').trim();
          return !tx || tx === '—' || tx === '-';
        }
        var requested = !colEmpty(s.doctor)
          ? colHtml(s.doctor)
          : !colEmpty(s.lab)
            ? '<span class="lab-hist-lab">' + colHtml(s.lab) + '</span>'
            : '<span class="lab-hist-empty">—</span>';
        var unit = s.unit ? ' <span class="lab-hist-unit">' + escapeHtml(s.unit) + '</span>' : '';
        var dataAttrs =
          ' data-date="' + escapeHtml(s.iso) + '"' +
          (s.num != null ? ' data-value="' + s.num + '"' : '') +
          ' data-flag="' + dir + '"';
        var latestAttr = i === 0 ? ' data-latest="' + tPlain('latest', 'mais recente') + '"' : '';
        return (
          '<tr class="' + rowCls + '"' + dataAttrs + '>' +
            '<td class="lab-hist-date"' + latestAttr + '>' + escapeHtml(s.date) + '</td>' +
            '<td class="lab-hist-doctor">' + requested + '</td>' +
            '<td class="lab-hist-val">' + escapeHtml(s.value) + unit + '</td>' +
            '<td class="lab-hist-status"><span class="pill ' + pillCls + '">' + pillLabel + '</span></td>' +
          '</tr>'
        );
      }).join('');

      var refAttrs =
        (refs.lo != null ? ' data-ref-low="'  + refs.lo + '"' : '') +
        (refs.hi != null ? ' data-ref-high="' + refs.hi + '"' : '') +
        (samples[0] && samples[0].unit ? ' data-unit="' + escapeHtml(samples[0].unit) + '"' : '');

      var historyHtml =
        '<div class="lab-test-history" aria-hidden="true"' + refAttrs + '>' +
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
      card.setAttribute('aria-haspopup', 'dialog');

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

  // Delegated click + keyboard opener for .lab-test-has-history cards —
  // opens the jc-labpop history dialog (table + chart); ESC / backdrop /
  // the × button close it. Idempotent: installs the listeners once per load.
  /* ── Lab history popup ─────────────────────────────────────────────
     Clicking a marker card with history opens a dialog card: the sample
     table (date · requested by · result · status) on the left and a
     time-series chart on the right — reference band with dashed min/max
     lines, one dot per result, out-of-range dots in red. Data comes from
     the card's hidden .lab-test-history block (see the data-* attrs the
     two builders emit), so the popup works identically for the static
     shells and the DB-rendered patients. */

  var LABPOP_ID = 'jc-labpop';

  function closeLabPopup() {
    var overlay = document.getElementById(LABPOP_ID);
    if (!overlay) return;
    var opener = overlay.__opener;
    overlay.remove();
    document.body.classList.remove('jc-labpop-open');
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function openLabPopup(card) {
    closeLabPopup();
    var hist = card.querySelector('.lab-test-history');
    var table = hist && hist.querySelector('.lab-test-history-table');
    if (!table) return;

    var nameEl = card.querySelector('.lab-test-name');
    var refEl = card.querySelector('.lab-test-ref');
    var rows = hist.querySelectorAll('.lab-hist-row');

    var unit = hist.getAttribute('data-unit') || '';
    var refLow = parseFloat(hist.getAttribute('data-ref-low'));
    var refHigh = parseFloat(hist.getAttribute('data-ref-high'));
    if (!isFinite(refLow)) refLow = null;
    if (!isFinite(refHigh)) refHigh = null;

    var points = [];
    rows.forEach(function (tr) {
      var d = tr.getAttribute('data-date');
      var v = parseFloat(tr.getAttribute('data-value'));
      if (d && isFinite(v)) points.push({ date: d, value: v, flag: tr.getAttribute('data-flag') || '' });
    });

    var chartHtml = '';
    if (points.length > 1) {
      chartHtml = svgLineChart({
        series: [{ color: '#244E6E', unit: unit, points: points }],
        width: 560, height: 330,
        ref_low: refLow, ref_high: refHigh,
      });
    }
    var hasRef = refLow != null || refHigh != null;
    var legendBits = [];
    if (hasRef) {
      legendBits.push(
        '<span class="jc-labpop-key"><span class="jc-labpop-key-dash"></span>' +
        t('reference limits', 'limites de referência') + '</span>');
    }
    if (points.some(function (p) { return p.flag === 'H' || p.flag === 'L'; })) {
      legendBits.push(
        '<span class="jc-labpop-key"><span class="jc-labpop-key-dot"></span>' +
        t('out of range', 'fora do intervalo') + '</span>');
    }
    var chartPane = chartHtml
      ? '<div class="jc-labpop-chartwrap">' + chartHtml +
          (legendBits.length ? '<div class="jc-labpop-legend">' + legendBits.join('') + '</div>' : '') +
        '</div>'
      : '';

    var subBits = [
      rows.length + ' ' + tPlain(rows.length === 1 ? 'result' : 'results',
                                 rows.length === 1 ? 'resultado' : 'resultados'),
    ];
    var overlay = document.createElement('div');
    overlay.id = LABPOP_ID;
    overlay.className = 'jc-labpop-backdrop';
    overlay.innerHTML =
      '<div class="jc-labpop" role="dialog" aria-modal="true" aria-label="' +
        tPlain('Exam history', 'Histórico do exame') + '">' +
        '<button type="button" class="jc-labpop-close" aria-label="' + tPlain('Close', 'Fechar') + '">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
        '</button>' +
        '<div class="jc-labpop-head">' +
          '<div class="jc-labpop-title">' + (nameEl ? nameEl.innerHTML : '') + '</div>' +
          '<div class="jc-labpop-sub">' + escapeHtml(subBits.join(' · ')) +
            (refEl ? ' <span class="jc-labpop-ref">· ' + refEl.innerHTML + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="jc-labpop-body' + (chartPane ? '' : ' jc-labpop-tableonly') + '">' +
          '<div class="jc-labpop-tablewrap"></div>' +
          chartPane +
        '</div>' +
      '</div>';

    // The table is CLONED from the card so both render paths (static
    // retrofit and DB renderer) show exactly what the card carries.
    overlay.querySelector('.jc-labpop-tablewrap').appendChild(table.cloneNode(true));

    overlay.__opener = card;
    document.body.appendChild(overlay);
    document.body.classList.add('jc-labpop-open');
    var closeBtn = overlay.querySelector('.jc-labpop-close');
    if (closeBtn) closeBtn.focus();
  }

  function installLabHistoryHandler() {
    if (document.body && document.body.dataset.jcLabHistoryHandler === '1') return;
    if (document.body) document.body.dataset.jcLabHistoryHandler = '1';
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.jc-labpop-close')) { closeLabPopup(); return; }
      var overlay = document.getElementById(LABPOP_ID);
      if (overlay && e.target === overlay) { closeLabPopup(); return; }
      var card = e.target && e.target.closest && e.target.closest('.lab-test-has-history');
      if (!card) return;
      if (e.target.closest('a, button, input, select, textarea')) return;
      openLabPopup(card);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById(LABPOP_ID)) {
        e.preventDefault();
        closeLabPopup();
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var card = e.target && e.target.closest && e.target.closest('.lab-test-has-history');
      if (!card || card !== e.target) return;
      e.preventDefault();
      openLabPopup(card);
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

  /* Builds the exams topic sections for the assembler: 'imaging' (imaging
     studies + ECG) and 'laboratory' (AI summary card + blood/urine panels +
     historical comparison + source PDFs). Returns HTML parts plus an after()
     hook that wires viewers/charts and fills the amber AI cards once the
     page is in the DOM.                                                    */
  function buildExamsParts(exams) {
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
      // Report sits BELOW the viewer (imaging-spec invariant: the doctor's
      // report always renders beneath the slice/3D surface for every study).
      return '<div class="img-study" data-manifest="' + escapeHtml(s.manifest_blob_key || '') + '">' +
        '<h3 class="img-study-title">' + imagingTitle(s) + ' <span class="ov-count-inline">' + meta + '</span></h3>' +
        body + reportBtn +
      '</div>';
    }

    // Comparative layout: studies sharing a date + body part (e.g. a CT and an
    // MRI of the lumbar spine on the same day) render side by side in a two-column
    // row so they read as the comparative pair they are. Singles stay full-width.
    // Input is already newest-first (API orders by study_date DESC).
    function renderImagingSection(list) {
      var groups = [], byKey = {};
      list.forEach(function (s) {
        var key = (s.study_date || '') + '|' + (s.body_part || '~' + (s.id || Math.random()));
        if (byKey[key] == null) { byKey[key] = groups.length; groups.push([]); }
        groups[byKey[key]].push(s);
      });
      return groups.map(function (g) {
        // Comparative side-by-side only for a genuine pair: same date + body part
        // AND two different modalities (e.g. CT + MRI of the lumbar spine). Two
        // studies of the same modality (e.g. two head MRIs same day) render
        // stacked full-width instead of a misleading "comparative" row.
        var mods = {};
        g.forEach(function (s) { mods[s.modality] = 1; });
        if (g.length < 2 || Object.keys(mods).length < 2) {
          return g.map(renderImagingStudy).join('');
        }
        return '<div class="img-compare">' +
            '<div class="img-compare-head">' +
              t('Comparative studies', 'Exames comparativos') + ' · ' +
              escapeHtml(formatDate(g[0].study_date)) +
            '</div>' +
            '<div class="img-compare-grid">' + g.map(renderImagingStudy).join('') + '</div>' +
          '</div>';
      }).join('');
    }

    var imagingStyle =
      '<style>' +
        '.img-compare{margin:8px 0 4px}' +
        '.img-compare-head{font:600 13px/1.2 Raleway,sans-serif;letter-spacing:.02em;text-transform:uppercase;' +
          'color:var(--jc-gold,#b8954a);margin:0 0 10px}' +
        // minmax(0,1fr) lets each column shrink below its content's intrinsic
        // width (the viewer/image), otherwise the two 620px-capped viewers
        // overflow the container. Viewers fill their column instead of forcing 620.
        '.img-compare-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start}' +
        '.img-compare-grid .img-study{margin:0;min-width:0}' +
        '.img-compare-grid .ct-grid.ct-grid-single{max-width:none}' +
        '.img-compare-grid .ct-viewer{max-width:none}' +
        '@media(max-width:860px){.img-compare-grid{grid-template-columns:1fr}}' +
      '</style>';

    var imagingHtml = imaging.length === 0 ? '' :
      '<section class="ov-section" id="imaging">' + imagingStyle +
        '<h2>' + t('Imaging studies', 'Estudos de imagem') + ' <span class="ov-count-inline">' + imaging.length + '</span></h2>' +
        renderImagingSection(imaging) +
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

    var laboratoryHtml = '';
    if (panels.length || docs.length) {
      laboratoryHtml =
        '<section class="ov-ai-summary" id="exams-ai-summary"></section>' +
        (panels.length
          ? '<h2 class="ov-panels-title" id="blood-urine">' + panelsTitleInner + '</h2>' + panelsHtml + comparisonHtml
          : '') +
        docsHtml;
    }

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
    function fillExamsAi(pnls, imgs, scopeEl) {
      // 1.2.1 consolidated AI Summary at the top of Exams.
      var summaryEl = document.getElementById('exams-ai-summary');
      if (summaryEl) summaryEl.innerHTML = examsSummaryHtml(offFromPanels(pnls), (imgs || []).length);

      // Per blood panel with out-of-range values: one grouped amber card —
      // what each marker means + possible reasons grounded in the patient's record.
      // Scope to OUR rendered view — Patient Zero's hidden static page also has a
      // .lab-panel-grid, and an unscoped index would inject into those hidden panels.
      var examMain = scopeEl || document.querySelector('.lumen-page-root');
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

    return {
      laboratoryHtml: laboratoryHtml,
      imagingHtml: imagingHtml + ecgHtml,
      after: function (scopeEl) {
        // Wire any .ct-viewer blocks we just injected (app.js's generic engine).
        if (typeof window !== 'undefined' && window.JCInitCtViewers) window.JCInitCtViewers();
        hydrateEcgCharts(scopeEl || document, p.clerk_user_id); // inline Lumen ECG SVG(s)
        wireEcgSwitcher(scopeEl || document, ecg, p.clerk_user_id); // date pill + version dropdown
        // Amber-card invariant: consolidated AI Summary at top + per-panel lab
        // cards + per-imagery finding cards.
        fillExamsAi(panels, imaging, scopeEl);
      },
    };
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
  function physBrowseCardsHtml(summary) {
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

    // (Removed the templated "AI Summary" lead card on the Physical hub — it
    // merely restated exam counts behind an AI pill and isn't canonical. The
    // canonical hub is the three entry cards; real synthesis lives on Exams and
    // in the home AI cards.)

    if (!cards) return '';
    return '<div class="entry-grid entry-grid-overview">' + cards + '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     DB-DRIVEN VITALS RENDERER  (drop-in for patient-context.js)
     ─────────────────────────────────────────────────────────────────────
     Reproduces Patient Zero's hand-tuned physical-vitals.html chart
     house-style, but driven from GET /api/vitals-range instead of a static
     data.js. Sections render ONLY when their underlying series has real data.

     In scope from patient-context.js (do NOT redeclare): t(en,pt),
     escapeHtml(s), and the module-level `patient`.

     Chart libs are loaded globally on physical-vitals.html:
       Chart.js 4.4.4 (Chart) · @sgratzl boxplot (registered) · Plotly 2.35.2.
     ═══════════════════════════════════════════════════════════════════════ */

  /* Health-palette tokens — byte-identical to physical-vitals.html's `const C`. */
  var C = {
    blue50:  '#EEF5FA', blue100: '#D8E8F2', blue200: '#B5D2E5',
    blue300: '#8BB8D2', blue400: '#5E97BC', blue500: '#3E7CA3',
    blue600: '#2F6489', blue700: '#244E6E', blue800: '#1B3B54',
    blue900: '#122A3D',
    green500: '#3D9460', green700: '#245F3C',
    amber500: '#C29327', amber700: '#785818',
    red500:   '#C73E3E', red700:   '#802626', red300: '#EB8585',
    ink:      '#1A2129',
    inkMid:   '#3E4956',
    inkSoft:  '#6E7B8A',
    inkFaint: '#94A0AE',
    grid:     'rgba(62,124,163,0.10)'
  };

  var vAxisCommon = {
    grid:  { color: C.grid, drawBorder: false },
    ticks: { color: C.inkSoft },
  };

  /* Chart-string language helper (reads html[lang] at build time). Distinct
     from patient-context's tPlain so it can also take arrays (month names). */
  function L(en, pt) { return (document.documentElement.lang === 'pt' ? pt : en); }

  /* Chart registry + builders. runVitalsBuilders re-runs every builder; each
     Chart.js builder destroys any prior instance on its canvas first. Plotly
     builders re-plot in place (Plotly.newPlot replaces). */
  var _vitalsChartInstances = [];
  var _vitalsBuilders = [];
  var _vitalsLangHooked = false;

  function runVitalsBuilders() {
    _vitalsBuilders.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[vitals chart]', e); }
    });
  }

  /* ── Small numeric helpers ────────────────────────────────────────────── */
  function vMean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function vMedian(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function vNums(arr, pick) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = pick(arr[i]);
      if (typeof v === 'number' && !isNaN(v)) out.push(v);
    }
    return out;
  }
  function vFmt(n, d) { return (n == null || isNaN(n)) ? '–' : Number(n).toFixed(d == null ? 1 : d); }
  /* Hours → "Nh MMm". */
  function vHm(h) {
    if (h == null || isNaN(h)) return '–';
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh += 1; mm = 0; }
    return hh + 'h ' + String(mm).padStart(2, '0') + 'm';
  }
  /* Map an ISO date to its ISO-week Monday (UTC). */
  function vIsoMonday(s) {
    var d = new Date(s + 'T12:00:00Z');
    var dayIdx = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayIdx);
    return d.toISOString().slice(0, 10);
  }
  /* Centered rolling mean over an array (nulls skipped). */
  function vRolling(arr, win) {
    var half = Math.floor(win / 2);
    return arr.map(function (_, i) {
      var slice = arr.slice(Math.max(0, i - half), i + half + 1)
        .filter(function (v) { return typeof v === 'number' && !isNaN(v); });
      if (!slice.length) return null;
      return +(slice.reduce(function (s, v) { return s + v; }, 0) / slice.length).toFixed(1);
    });
  }
  /* Circular rolling mean (wraps at midnight) — for time-of-day series. */
  function vSmoothCirc(arr, w) {
    var n = arr.length, out = new Array(n);
    for (var i = 0; i < n; i++) {
      var sum = 0, cnt = 0;
      for (var k = -w; k <= w; k++) {
        var j = (i + k + n) % n, v = arr[j];
        if (v != null && !isNaN(v)) { sum += v; cnt++; }
      }
      out[i] = cnt ? sum / cnt : NaN;
    }
    return out;
  }
  function vMonthNames() {
    return L(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
             ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
  }
  function vFmtMonth(m) { return vMonthNames()[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(2, 4); }

  /* ── Markup helpers ───────────────────────────────────────────────────── */
  function vTiles(cards) {
    return '<div class="metric-grid">' + cards.map(function (c) {
      return '<div class="metric-card">' +
        '<div class="metric-label">' + c.label + '</div>' +
        '<div class="metric-value">' + c.value + (c.unit ? '<small>' + c.unit + '</small>' : '') + '</div>' +
        (c.note ? '<div class="metric-note">' + c.note + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function vCanvasCard(id, titleEn, titlePt, metaEn, metaPt, wrapCls) {
    return '<div class="chart-card"><div class="chart-card-head">' +
      '<div class="chart-card-title">' + t(titleEn, titlePt) + '</div>' +
      '<div class="chart-card-meta">' + t(metaEn, metaPt) + '</div></div>' +
      '<div class="chart-wrap' + (wrapCls ? ' ' + wrapCls : '') + '"><canvas id="' + id + '"></canvas></div></div>';
  }
  function vPlotCard(id, titleEn, titlePt, metaEn, metaPt) {
    return '<div class="chart-card"><div class="chart-card-head">' +
      '<div class="chart-card-title">' + t(titleEn, titlePt) + '</div>' +
      '<div class="chart-card-meta">' + t(metaEn, metaPt) + '</div></div>' +
      '<div id="' + id + '" class="chart-wrap tall"></div></div>';
  }
  function vSection(num, id, titleEn, titlePt, descEn, descPt, bodyHtml) {
    var nn = String(num).padStart(2, '0');
    return '<section class="report-section" id="' + id + '"><div class="container">' +
      '<div class="section-label">' + nn + ' · ' + t(titleEn, titlePt) + '</div>' +
      '<h2 class="section-title">' + t(titleEn, titlePt) + '</h2>' +
      (descEn || descPt ? '<p class="section-desc">' + t(descEn || '', descPt || '') + '</p>' : '') +
      bodyHtml +
      '</div></section>';
  }

  /* Self-contained CSS for .vit-nav — mirrors the plain (non-sidebar) look of
     the shared .section-nav rule, deliberately under its own class names so it
     is immune to the body.has-side-nav descendant overrides (see the comment
     at the call site). Injected once per page load. */
  var _vitalsNavStyleInjected = false;
  function injectVitalsNavStyle() {
    if (_vitalsNavStyleInjected) return;
    _vitalsNavStyleInjected = true;
    var css =
      '.vit-nav{position:sticky;top:60px;z-index:40;background:rgba(252,253,254,0.95);' +
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-bottom:1px solid var(--border-subtle);padding:0.75rem 2rem;' +
        'overflow-x:auto;white-space:nowrap;}' +
      '.vit-nav-inner{display:flex;gap:1.5rem;max-width:1200px;margin:0 auto;}' +
      '.vit-nav a{font-family:var(--font-mono);font-size:12px;font-weight:500;' +
        'letter-spacing:0.10em;text-transform:uppercase;color:var(--text-muted);' +
        'padding:0.25rem 0;border-bottom:1px solid transparent;' +
        'transition:color 0.15s,border-color 0.15s;text-decoration:none;}' +
      '.vit-nav a:hover,.vit-nav a.active{color:var(--blue-700);border-bottom-color:var(--blue-400);}' +
      '@media(max-width:880px){.vit-nav{padding:0.75rem 1.25rem;}}';
    var style = document.createElement('style');
    style.setAttribute('data-vit-nav', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ── Plotly common bits ───────────────────────────────────────────────── */
  var VPLOT_CONFIG = {
    displaylogo: false, responsive: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines']
  };
  function vPlotLayout(extra) {
    var base = {
      autosize: true,
      margin: { l: 52, r: 16, t: 12, b: 60 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor:  'rgba(0,0,0,0)',
      font: { family: "'IBM Plex Sans', sans-serif", color: C.inkSoft, size: 12 },
      hoverlabel: { bgcolor: '#FFFFFF', bordercolor: C.inkMid, font: { color: C.ink } },
      showlegend: false
    };
    if (extra) for (var k in extra) base[k] = extra[k];
    return base;
  }
  var V_NOLINE = { width: 0, color: 'rgba(0,0,0,0)' };
  /* Four stacked-fill band traces (±2 SD outer, ±1 SD inner) between mean±SD. */
  function vBandTraces(xs, mean, sd, band2, band1) {
    var l2 = mean.map(function (m, i) { return m - 2 * sd[i]; });
    var u2 = mean.map(function (m, i) { return m + 2 * sd[i]; });
    var l1 = mean.map(function (m, i) { return m - sd[i]; });
    var u1 = mean.map(function (m, i) { return m + sd[i]; });
    return [
      { x: xs, y: l2, type: 'scatter', mode: 'lines', line: V_NOLINE, showlegend: false, hoverinfo: 'skip' },
      { x: xs, y: u2, type: 'scatter', mode: 'lines', line: V_NOLINE, fill: 'tonexty', fillcolor: band2, showlegend: false, hoverinfo: 'skip' },
      { x: xs, y: l1, type: 'scatter', mode: 'lines', line: V_NOLINE, showlegend: false, hoverinfo: 'skip' },
      { x: xs, y: u1, type: 'scatter', mode: 'lines', line: V_NOLINE, fill: 'tonexty', fillcolor: band1, showlegend: false, hoverinfo: 'skip' }
    ];
  }
  /* 24h tick labels for time-of-day pattern charts. */
  function vTodAxis() {
    return {
      tickmode: 'array',
      tickvals: [0, 180, 360, 540, 720, 900, 1080, 1260, 1440],
      ticktext: L(['12am', '3am', '6am', '9am', '12pm', '3pm', '6pm', '9pm', '12am'],
                  ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h', '0h']),
      range: [0, 1440], showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft }
    };
  }
  function vTodCustomData(xs) {
    return xs.map(function (min) {
      var h = Math.floor(min / 60), mm = min % 60;
      if (document.documentElement.lang === 'pt') {
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      }
      var ampm = h < 12 ? 'am' : 'pm';
      var h12 = (h % 12) === 0 ? 12 : (h % 12);
      return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ampm;
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     renderVitals — fetch the range, build only the sections with data,
     mount the shell, then initialise the charts.
     ══════════════════════════════════════════════════════════════════════ */
  /* ══ Body composition · bioimpedance (BIA) ═══════════════════════════
     Renders bioimpedance_exams (+ bioimpedance_segments) from
     /api/patient-body-composition (payloads.bodyComp). Sections are
     registry ids bia-cards / bia-muscle-fat / bia-obesity / bia-segmental
     / bia-history, orders 21-25.

     DEVICE-SHAPE DRIVEN. Every sub-section returns null when its source data
     is absent, so the assembler omits it entirely (I-5 — never an empty
     skeleton). A Tanita TBF-410 (whole-body only) yields cards +
     muscle-fat + obesity; an InBody additionally yields the segmental
     silhouettes. History needs >=2 exams.

     MEASURED VALUES ARE PATIENT DATA — no .ai-pill anywhere in this block.
     The AI synthesis narrative is a separate card generated elsewhere.

     REFERENCE BASES. Every reference is stated in its section's desc line so
     no number on screen is an unattributed claim:
       ideal fat %  <- the DEVICE's own printed table (raw_extract), by sex+age
       BMI band     <- WHO 18.5-25
       weight band  <- that same WHO BMI band applied to the exam's own height
     FFM is fat-free mass and is NEVER relabelled as muscle; SMM renders only
     when the device actually measured it.                                */

  function biaExams(ctx) {
    var d = ctx && ctx.payloads && ctx.payloads.bodyComp;
    return (d && Array.isArray(d.exams)) ? d.exams : [];
  }
  function biaNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  /* The device's own printed "ideal fat %" table, keyed by sex + age band.
     Read from raw_extract — never hardcoded, and absent for devices that
     don't print one (then the fat rows simply carry no reference). */
  function biaIdealFatPct(e) {
    var rx = e && e.raw_extract;
    var ref = rx && rx.device_reference_ideal_fat_percent;
    var tbl = ref && ref.by_age;
    var age = biaNum(e && e.age_years);
    var sex = (e && (e.sex === 'male' || e.sex === 'female')) ? e.sex : null;
    if (!tbl || age == null || !sex) return null;
    var band = age <= 19 ? 'up_to_19' : age <= 29 ? '20_29' : age <= 39 ? '30_39'
             : age <= 49 ? '40_49' : age <= 59 ? '50_59' : '60_plus';
    return (tbl[band] && biaNum(tbl[band][sex]));
  }
  var BIA_BMI_LOW = 18.5, BIA_BMI_HIGH = 25;   // WHO adult band
  /* Healthy-weight band = the WHO BMI band applied to THIS exam's height. */
  function biaWeightBand(e) {
    var h = biaNum(e && e.height_cm);
    if (h == null || h <= 0) return null;
    var m2 = (h / 100) * (h / 100);
    return { low: BIA_BMI_LOW * m2, high: BIA_BMI_HIGH * m2 };
  }
  function biaDeviceName(e) {
    return [e.device_manufacturer, e.device_model].filter(Boolean).join(' ');
  }
  /* Provenance strip under the block title: date · device · facility ·
     performing professional — the five facts the ingestion captured. */
  function biaMetaLine(e) {
    var bits = [];
    if (e.exam_date) bits.push(escapeHtml(formatDate(e.exam_date)));
    var dev = biaDeviceName(e);
    if (dev) bits.push(escapeHtml(dev));
    var fac = [e.facility_name, e.facility_city].filter(Boolean).join(', ');
    if (fac) bits.push(escapeHtml(fac));
    if (e.performing_professional) bits.push(escapeHtml(e.performing_professional));
    return bits.length ? '<p class="bia-meta">' + bits.join(' · ') + '</p>' : '';
  }
  function biaSection(id, labelEn, labelPt, titleEn, titlePt, descEn, descPt, bodyHtml) {
    return '<section class="report-section" id="' + id + '"><div class="container">' +
      '<div class="section-label">' + t(labelEn, labelPt) + '</div>' +
      '<h2 class="section-title">' + t(titleEn, titlePt) + '</h2>' +
      ((descEn || descPt) ? '<p class="section-desc">' + t(descEn || '', descPt || '') + '</p>' : '') +
      bodyHtml +
      '</div></section>';
  }
  /* One labelled metric row: value + the shared lab-bar (track, reference
     band, marker). Reuses renderLabBar so the bar semantics are identical to
     the blood-test cards. */
  function biaBarRow(labelHtml, valueHtml, value, refLow, refHigh, noteHtml) {
    var status = classifyLab(value, refLow, refHigh, null);
    return '<div class="bia-row">' +
      '<div class="bia-row-head">' +
        '<span class="bia-row-label">' + labelHtml + '</span>' +
        '<span class="bia-row-val">' + valueHtml + '</span>' +
      '</div>' +
      renderLabBar(value, refLow, refHigh, status) +
      (noteHtml ? '<div class="bia-row-note">' + noteHtml + '</div>' : '') +
      '</div>';
  }
  function biaVal(n, unit) {
    return '<span class="lab-val-num">' + escapeHtml(fmtLabNum(n)) + '</span>' +
      (unit ? ' <span class="lab-val-unit">' + escapeHtml(unit) + '</span>' : '');
  }

  /* C.1 — value cards. Reuses renderLabTest (the blood-test bar card)
     verbatim; metrics with no reference range pass no_ref so the card shows
     the measured number without an unearned "Normal" verdict. */
  function renderBiaCards(ctx) {
    var exams = biaExams(ctx);
    if (!exams.length) return null;
    var e = exams[0];
    var metrics = [];
    function add(v, unit, en, pt) {
      var val = biaNum(v);
      if (val == null) return;   // device didn't measure it -> no card
      metrics.push({ marker_html: t(en, pt), value: val, unit: unit,
                     ref_low: null, ref_high: null, no_ref: true });
    }
    add(e.weight_kg, 'kg', 'Weight', 'Peso');
    add(e.fat_mass_kg, 'kg', 'Body fat mass', 'Massa de gordura');
    add(e.ffm_kg, 'kg', 'Fat-free mass (FFM)', 'Massa livre de gordura (FFM)');
    add(e.tbw_kg, 'kg', 'Total body water (TBW)', 'Água corporal total (TBW)');
    add(e.waist_circumference_cm, 'cm', 'Waist circumference', 'Circunferência abdominal');
    /* InBody-class only — each renders iff the device produced it. */
    add(e.skeletal_muscle_mass_kg, 'kg', 'Skeletal muscle mass (SMM)', 'Massa muscular esquelética (SMM)');
    add(e.protein_kg, 'kg', 'Protein', 'Proteína');
    add(e.minerals_kg, 'kg', 'Minerals', 'Minerais');
    add(e.visceral_fat_level, '', 'Visceral fat level', 'Nível de gordura visceral');
    if (!metrics.length) return null;

    /* FFM-is-not-muscle note, in the device's own terms — shown only when the
       device reported FFM but NOT skeletal muscle mass (the Tanita case),
       which is exactly when the two could be confused. */
    var note = '';
    if (biaNum(e.ffm_kg) != null && biaNum(e.skeletal_muscle_mass_kg) == null) {
      note = '<p class="bia-note">' + t(
        'Fat-free mass (FFM) is everything that is not fat — muscle, bone and organ/residual mass together. It is <strong>not</strong> skeletal muscle mass: this device does not measure that separately.',
        'A massa livre de gordura (FFM) é tudo o que não é gordura — músculo, massa óssea e massa visceral/residual somados. <strong>Não</strong> é a massa muscular esquelética: este aparelho não a mede separadamente.'
      ) + '</p>';
    }
    return biaSection('bia-cards',
      'Bioimpedance' + (biaDeviceName(e) ? ' · ' + escapeHtml(biaDeviceName(e)) : ''),
      'Bioimpedância' + (biaDeviceName(e) ? ' · ' + escapeHtml(biaDeviceName(e)) : ''),
      'Body composition', 'Composição corporal',
      'Whole-body measurements from the bioimpedance exam, as the device reported them.',
      'Medidas de corpo inteiro do exame de bioimpedância, conforme o aparelho as reportou.',
      biaMetaLine(e) +
      '<div class="lab-panel-body bia-cards">' + metrics.map(renderLabTest).join('') + '</div>' +
      note);
  }

  /* C.2 — muscle-fat rows. Weight + fat mass (+ SMM only when measured). */
  function renderBiaMuscleFat(ctx) {
    var exams = biaExams(ctx);
    if (!exams.length) return null;
    var e = exams[0];
    var rows = [];
    var band = biaWeightBand(e);
    var w = biaNum(e.weight_kg);
    if (w != null && band) {
      rows.push(biaBarRow(t('Weight', 'Peso'), biaVal(w, 'kg'), w, band.low, band.high, ''));
    }
    var smm = biaNum(e.skeletal_muscle_mass_kg);
    if (smm != null) {
      /* Only the device can supply an SMM reference; we never invent one. */
      rows.push(biaBarRow(t('Skeletal muscle mass', 'Massa muscular esquelética'), biaVal(smm, 'kg'), smm, null, null, ''));
    }
    var fm = biaNum(e.fat_mass_kg);
    var idealPct = biaIdealFatPct(e);
    if (fm != null) {
      var idealFm = (idealPct != null && w != null) ? (idealPct / 100) * w : null;
      var pctOf = idealFm ? Math.round((fm / idealFm) * 100) : null;
      rows.push(biaBarRow(t('Body fat mass', 'Massa de gordura'), biaVal(fm, 'kg'),
        fm, null, idealFm,
        pctOf != null ? t(
          pctOf + '% of the device\'s ideal for this age and sex (' + fmtLabNum(idealFm) + ' kg at ' + idealPct + '%).',
          pctOf + '% do ideal do aparelho para esta idade e sexo (' + fmtLabNum(idealFm) + ' kg a ' + idealPct + '%).') : ''));
    }
    if (!rows.length) return null;
    return biaSection('bia-muscle-fat', 'Analysis', 'Análise',
      'Muscle-fat analysis', 'Análise músculo-gordura',
      'Each measurement against its reference. Healthy-weight range is the WHO BMI band (18.5-25) applied to this exam\'s height; the fat reference is the device\'s own printed ideal for this age and sex.',
      'Cada medida em relação à sua referência. A faixa de peso saudável é a banda de IMC da OMS (18,5-25) aplicada à altura deste exame; a referência de gordura é o ideal impresso pelo próprio aparelho para esta idade e sexo.',
      '<div class="bia-rows">' + rows.join('') + '</div>');
  }

  /* C.3 — obesity rows: BMI + PBF. */
  function renderBiaObesity(ctx) {
    var exams = biaExams(ctx);
    if (!exams.length) return null;
    var e = exams[0];
    var rows = [];
    var bmi = biaNum(e.bmi);
    if (bmi != null) {
      rows.push(biaBarRow(t('BMI', 'IMC'), biaVal(bmi, 'kg/m²'), bmi, BIA_BMI_LOW, BIA_BMI_HIGH, ''));
    }
    var pbf = biaNum(e.fat_percent);
    var idealPct = biaIdealFatPct(e);
    if (pbf != null) {
      rows.push(biaBarRow(t('Body fat percentage (PBF)', 'Percentual de gordura (PBF)'), biaVal(pbf, '%'),
        pbf, null, idealPct,
        idealPct != null ? t(
          'Device\'s printed ideal for this age and sex: ' + idealPct + '%.',
          'Ideal impresso pelo aparelho para esta idade e sexo: ' + idealPct + '%.') : ''));
    }
    if (!rows.length) return null;

    /* The device's OWN printed caveat, verbatim from raw_extract — shown
       because BMI cannot separate fat from fat-free mass, and this exam
       classified the body type as ATHLETIC. Quoting the manufacturer is not
       Lumen interpreting the result; it is the reference stating its own
       limits. Rendered only when the device actually printed one. */
    var rx = e.raw_extract || {};
    var ref = rx.device_reference_ideal_fat_percent || {};
    var caveat = ref.caveat_verbatim;
    var caveatHtml = caveat
      ? '<p class="bia-note bia-caveat">' +
          '<span class="bia-caveat-src">' + t('Device note', 'Nota do aparelho') +
          (biaDeviceName(e) ? ' · ' + escapeHtml(biaDeviceName(e)) : '') + '</span>' +
          '<span class="bia-caveat-txt">&ldquo;' + escapeHtml(caveat) + '&rdquo;</span>' +
        '</p>'
      : '';
    var typeHtml = e.body_type
      ? '<p class="bia-note">' + t(
          'This exam classified the body type as <strong>' + escapeHtml(e.body_type) + '</strong>. BMI is a weight-for-height ratio and does not distinguish fat from fat-free mass.',
          'Este exame classificou o tipo corporal como <strong>' + escapeHtml(e.body_type) + '</strong>. O IMC é uma razão peso-altura e não distingue gordura de massa livre de gordura.'
        ) + '</p>'
      : '';
    return biaSection('bia-obesity', 'Analysis', 'Análise',
      'Obesity analysis', 'Análise de obesidade',
      'BMI against the WHO adult band (18.5-25) and body-fat percentage against the device\'s own printed ideal.',
      'IMC em relação à banda adulta da OMS (18,5-25) e percentual de gordura em relação ao ideal impresso pelo próprio aparelho.',
      '<div class="bia-rows">' + rows.join('') + '</div>' + typeHtml + caveatHtml);
  }

  /* C.4 — segmental silhouettes. Renders ONLY when the device produced
     per-region rows (InBody-class). Zero rows -> null -> section omitted, so
     a whole-body-only device (Tanita) shows nothing here rather than an
     empty skeleton. */
  var BIA_SEGMENTS = [
    { key: 'right_arm', en: 'Right arm', pt: 'Braço direito' },
    { key: 'left_arm',  en: 'Left arm',  pt: 'Braço esquerdo' },
    { key: 'trunk',     en: 'Trunk',     pt: 'Tronco' },
    { key: 'right_leg', en: 'Right leg', pt: 'Perna direita' },
    { key: 'left_leg',  en: 'Left leg',  pt: 'Perna esquerda' },
  ];
  /* Anatomical anchors in the SVG viewBox, front-facing: the patient's RIGHT
     limbs sit on the VIEWER's left, matching the device's RA/LA/TR/RL/LL. */
  var BIA_SEG_POS = {
    right_arm: { x: 14,  y: 40 }, left_arm: { x: 86, y: 40 },
    trunk:     { x: 50,  y: 42 },
    right_leg: { x: 30,  y: 84 }, left_leg: { x: 70, y: 84 },
  };
  /* Status -> chip class, PER METRIC. The unhealthy direction is red on each
     body, so the SAME enum value maps to different colours:
       lean: below  = red (too little muscle), normal/above = green
       fat:  above  = red (too much fat),      normal/below = green
     Falls back to deriving the status from % vs. ideal when the device left
     the status column null. */
  function biaSegStatus(status, pctIdeal, metric) {
    var s = status;
    if (!s && pctIdeal != null) {
      s = pctIdeal < 90 ? 'below' : pctIdeal > 110 ? 'above' : 'normal';
    }
    if (!s) return null;
    var bad = (metric === 'lean') ? 'below' : 'above';
    return {
      key: s,
      cls: (s === bad) ? 'pill-flag' : 'pill-ok',
      label: s === 'below' ? t('Below', 'Abaixo')
           : s === 'above' ? t('Above', 'Acima')
           : t('Normal', 'Normal'),
    };
  }
  function biaBodySvg(segs, metric) {
    var boxes = BIA_SEGMENTS.map(function (def) {
      var row = segs[def.key];
      if (!row) return '';
      var pos = BIA_SEG_POS[def.key];
      var mass = biaNum(metric === 'lean' ? row.lean_mass_kg : row.fat_mass_kg);
      var pct = biaNum(metric === 'lean' ? row.lean_pct_ideal : row.fat_pct_ideal);
      var st = biaSegStatus(metric === 'lean' ? row.lean_status : row.fat_status, pct, metric);
      if (mass == null && pct == null && !st) return '';
      return '<div class="bia-seg-box" style="left:' + pos.x + '%;top:' + pos.y + '%;">' +
        (mass != null ? '<span class="bia-seg-kg">' + escapeHtml(fmtLabNum(mass)) + ' kg</span>' : '') +
        (pct != null ? '<span class="bia-seg-pct">' + escapeHtml(fmtLabNum(pct)) + '%</span>' : '') +
        (st ? '<span class="pill ' + st.cls + ' bia-seg-chip">' + st.label + '</span>' : '') +
        '</div>';
    }).join('');
    /* Front-facing body outline, drawn from the petrol tokens (same fill +
       stroke treatment as the brand silhouette). */
    var body =
      '<svg class="bia-body-svg" viewBox="0 0 100 120" aria-hidden="true">' +
        '<circle class="bia-body-shape" cx="50" cy="11" r="8"/>' +
        '<path class="bia-body-shape" d="M50 21 C43 21 38 24 36 29 L33 45 L28 62 L34 63 L38 48 L39 60 L37 78 L44 78 L47 60 L50 60 L53 60 L56 78 L63 78 L61 60 L62 48 L66 63 L72 62 L67 45 L64 29 C62 24 57 21 50 21 Z"/>' +
        '<path class="bia-body-shape" d="M39 79 L37 104 L35 118 L44 118 L46 104 L50 84 L54 104 L56 118 L65 118 L63 104 L61 79 Z"/>' +
      '</svg>';
    return '<div class="bia-body">' +
        '<h4 class="bia-body-title">' +
          (metric === 'lean' ? t('Lean mass by limb', 'Massa magra por membro')
                             : t('Fat by limb', 'Gordura por membro')) +
        '</h4>' +
        '<div class="bia-body-stage">' + body + boxes + '</div>' +
      '</div>';
  }
  function renderBiaSegmental(ctx) {
    var exams = biaExams(ctx);
    if (!exams.length) return null;
    var e = exams[0];
    var rows = Array.isArray(e.segments) ? e.segments : [];
    if (!rows.length) return null;   // whole-body-only device -> omit entirely
    var segs = {};
    rows.forEach(function (r) { if (r && r.segment) segs[r.segment] = r; });
    var hasLean = rows.some(function (r) { return biaNum(r.lean_mass_kg) != null || biaNum(r.lean_pct_ideal) != null; });
    var hasFat  = rows.some(function (r) { return biaNum(r.fat_mass_kg)  != null || biaNum(r.fat_pct_ideal)  != null; });
    if (!hasLean && !hasFat) return null;
    var bodies = (hasLean ? biaBodySvg(segs, 'lean') : '') + (hasFat ? biaBodySvg(segs, 'fat') : '');
    return biaSection('bia-segmental', 'Analysis', 'Análise',
      'Segmental analysis', 'Análise segmentar',
      '', '',
      '<p class="bia-meta bia-meta-right">' + t(
        'Lean mass and fat by limb · five regions · % vs. device ideal',
        'Massa magra e gordura por membro · cinco regiões · % vs. ideal do aparelho') + '</p>' +
      '<div class="bia-bodies">' + bodies + '</div>');
  }

  /* C.5 — history line chart. Needs >=2 exams; a single measurement has no
     trend, so the section is omitted until a second one exists. Chart.js
     (the Vitals page's charting library — not Plotly). */
  function renderBiaHistory(ctx) {
    var exams = biaExams(ctx);
    if (exams.length < 2) return null;
    var series = exams.slice().sort(function (a, b) {
      return (dateMs(a.exam_date) || 0) - (dateMs(b.exam_date) || 0);   // oldest -> newest
    });
    var hasSmm = series.some(function (e) { return biaNum(e.skeletal_muscle_mass_kg) != null; });
    var el = biaSection('bia-history', 'Trend', 'Tendência',
      'Body composition history', 'Histórico de composição corporal',
      'Each bioimpedance exam over time. Weight and fat mass in kg (left axis); body-fat percentage (right axis).',
      'Cada exame de bioimpedância ao longo do tempo. Peso e massa de gordura em kg (eixo esquerdo); percentual de gordura (eixo direito).',
      '<div class="chart-card"><div class="chart-wrap"><canvas id="biaHistChart"></canvas></div></div>');
    return {
      el: (function () { var d = document.createElement('div'); d.innerHTML = el; return d; })(),
      after: function () {
        var cv = document.getElementById('biaHistChart');
        if (!cv || !window.Chart) return;
        if (Chart.getChart(cv)) Chart.getChart(cv).destroy();
        var ds = [
          { label: L('Weight (kg)', 'Peso (kg)'), data: series.map(function (e) { return biaNum(e.weight_kg); }),
            borderColor: C.blue600, backgroundColor: 'rgba(94,151,188,0.18)', tension: 0.3, yAxisID: 'y', fill: true, borderWidth: 2, pointRadius: 3, pointBackgroundColor: C.blue600 },
          { label: L('Body fat mass (kg)', 'Massa de gordura (kg)'), data: series.map(function (e) { return biaNum(e.fat_mass_kg); }),
            borderColor: C.red500, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y', borderWidth: 2, pointRadius: 2, pointBackgroundColor: C.red500 },
          { label: L('Body fat (%)', 'Gordura corporal (%)'), data: series.map(function (e) { return biaNum(e.fat_percent); }),
            borderColor: C.amber500, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y1', borderWidth: 2, pointRadius: 2, pointBackgroundColor: C.amber500, borderDash: [4, 4] },
        ];
        if (hasSmm) {
          ds.splice(1, 0, { label: L('Skeletal muscle mass (kg)', 'Massa muscular esquelética (kg)'),
            data: series.map(function (e) { return biaNum(e.skeletal_muscle_mass_kg); }),
            borderColor: C.green500, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y', borderWidth: 2, pointRadius: 2, pointBackgroundColor: C.green500 });
        }
        new Chart(cv, {
          type: 'line',
          data: { labels: series.map(function (e) { return e.exam_date; }), datasets: ds },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y:  { position: 'left',  title: { display: true, text: 'kg' } },
              y1: { position: 'right', title: { display: true, text: '%' }, grid: { drawOnChartArea: false } },
            },
          },
        });
      },
    };
  }

  /* Computes the vitals chart sections for the assembler, keyed by the
     registry section ids (body-composition / sleep / movement /
     cardiovascular / stress-resilience / blood-pressure). The vitals-range
     payload is fetched by the assembler (page-assembler.js). Chart builders
     queue into _vitalsBuilders; the provider's after() hook runs them once
     the canvases are in the DOM. Returns null when no series has data —
     the registry gates then leave the page to the honest empty state.    */
  function computeVitalsParts(summary, d) {
    var b = (summary && summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    /* Normalise each series to an array/object we can presence-test. */
    var weight = d.weight || [];
    var steps = d.steps || [];
    var hrvRhr = d.hrvRhr || [];
    var stressRes = d.stressRes || [];
    var bp = d.bp || [];
    var bpByWeek = d.bpByWeek || [];
    var rhrByWeek = d.rhrByWeek || [];
    var sleepBox = d.sleepBox || null;
    var sleepStagesByWeek = d.sleepStagesByWeek || [];
    var hrByTod = d.hrByTod || [];

    /* Presence tests. */
    var stageHasData = function (s) { return s && typeof s.median === 'number' && s.n; };
    var hasBody = weight.length > 0;
    var hasSleep = sleepStagesByWeek.length > 0 && sleepBox &&
      (stageHasData(sleepBox.total) || stageHasData(sleepBox.deep) || stageHasData(sleepBox.rem) ||
       stageHasData(sleepBox.light) || stageHasData(sleepBox.awake));
    var hasMovement = steps.length > 0;
    var hasCardio = hrvRhr.length > 0;
    var hasHrTod = hrByTod.length > 0 && hrByTod.some(function (r) { return r && r[0] > 0; });
    var hasRhrWeek = rhrByWeek.length > 0 && rhrByWeek.some(function (r) { return typeof r.rhr === 'number'; });
    var hasStress = stressRes.length > 0 && stressRes.some(function (r) { return typeof r[1] === 'number' || typeof r[3] === 'number'; });
    var hasBp = bp.length > 0;
    var hasBpWeek = bpByWeek.length > 0;

    if (!hasBody && !hasSleep && !hasMovement && !hasCardio && !hasStress && !hasBp) {
      return null; // nothing to draw — gates emit nothing (I-5)
    }

    /* Reset registries for this render. */
    _vitalsChartInstances = [];
    _vitalsBuilders = [];

    /* Build section markup + collect nav entries + queue chart builders. */
    var nav = [];
    var parts = {};
    var order = [];
    var num = 0;
    var NAV_TO_KEY = {
      'vit-body': 'body-composition', 'vit-sleep': 'sleep', 'vit-movement': 'movement',
      'vit-cardio': 'cardiovascular', 'vit-stress': 'stress-resilience', 'vit-bp': 'blood-pressure',
    };
    function addNav(id, en, pt) {
      nav.push({ id: id, en: en, pt: pt });
      if (NAV_TO_KEY[id]) order.push(NAV_TO_KEY[id]);
    }

    /* ── 1 · Body composition ───────────────────────────────────────────── */
    if (hasBody) {
      num++;
      addNav('vit-body', 'Body composition', 'Composição corporal');
      var latest = weight[weight.length - 1];
      var wVals = vNums(weight, function (r) { return r[1]; });
      var fVals = vNums(weight, function (r) { return r[2]; });
      var mVals = vNums(weight, function (r) { return r[3]; });
      var tiles = [];
      if (latest[1] != null) tiles.push({ label: t('Latest weight', 'Peso atual'), value: vFmt(latest[1]), unit: 'kg' });
      if (latest[2] != null) tiles.push({ label: t('Body fat', 'Gordura corporal'), value: vFmt(latest[2]), unit: '%' });
      if (latest[3] != null) tiles.push({ label: t('Muscle mass', 'Massa muscular'), value: vFmt(latest[3]), unit: 'kg' });
      /* BMI omitted — height is not carried in the vitals-range API. */
      parts['body-composition'] = vSection(num, 'vit-body', 'Body composition', 'Composição corporal',
        'Weight, muscle mass and body-fat trend from connected smart-scale readings.',
        'Tendência de peso, massa muscular e gordura corporal a partir de balanças conectadas.',
        vTiles(tiles) +
        vCanvasCard('vBodyChart', 'Body composition trend', 'Tendência da composição corporal',
          'Weight + muscle (kg, left) · body fat (%, right) · n=' + wVals.length + ' readings',
          'Peso + músculo (kg, esq.) · gordura (%, dir.) · n=' + wVals.length + ' leituras'));

      _vitalsBuilders.push(function () {
        var el = document.getElementById('vBodyChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        _vitalsChartInstances.push(new Chart(el, {
          type: 'line',
          data: {
            labels: weight.map(function (r) { return r[0]; }),
            datasets: [
              { label: L('Body weight (kg)', 'Peso corporal (kg)'), data: weight.map(function (r) { return r[1]; }),
                borderColor: C.blue600, backgroundColor: 'rgba(94,151,188,0.18)', tension: 0.3, yAxisID: 'y', fill: true, borderWidth: 2, pointRadius: 3, pointBackgroundColor: C.blue600 },
              { label: L('Muscle mass (kg)', 'Massa muscular (kg)'), data: weight.map(function (r) { return r[3]; }),
                borderColor: C.green500, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y', borderWidth: 2, pointRadius: 2, pointBackgroundColor: C.green500 },
              { label: L('Body fat (%)', 'Gordura corporal (%)'), data: weight.map(function (r) { return r[2]; }),
                borderColor: C.red500, backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y1', borderWidth: 2, pointRadius: 2, pointBackgroundColor: C.red500, borderDash: [4, 4] },
            ]
          },
          options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { color: C.inkSoft } } },
            scales: {
              y:  Object.assign({}, vAxisCommon, { position: 'left', title: { display: true, text: 'kg', color: C.inkSoft } }),
              y1: Object.assign({}, vAxisCommon, { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%', color: C.inkSoft } }),
              x:  Object.assign({}, vAxisCommon, { ticks: Object.assign({}, vAxisCommon.ticks, { maxTicksLimit: 9, maxRotation: 0 }) })
            }
          }
        }));
      });
    }

    /* ── 2 · Sleep architecture ─────────────────────────────────────────── */
    if (hasSleep) {
      num++;
      addNav('vit-sleep', 'Sleep architecture', 'Arquitetura do sono');
      var sTiles = [];
      if (stageHasData(sleepBox.total)) sTiles.push({ label: t('Median total sleep', 'Sono total (mediana)'), value: vHm(sleepBox.total.median) });
      if (stageHasData(sleepBox.deep)) sTiles.push({ label: t('Median deep', 'Profundo (mediana)'), value: vHm(sleepBox.deep.median) });
      if (stageHasData(sleepBox.rem)) sTiles.push({ label: t('Median REM', 'REM (mediana)'), value: vHm(sleepBox.rem.median) });
      if (stageHasData(sleepBox.light)) sTiles.push({ label: t('Median light', 'Leve (mediana)'), value: vHm(sleepBox.light.median) });
      var nNights = (d.meta && d.meta.nights) || (sleepBox.total && sleepBox.total.n) || 0;
      parts['sleep'] = vSection(num, 'vit-sleep', 'Sleep architecture', 'Arquitetura do sono',
        'Per-night sleep-stage distribution and how the nightly composition drifts week to week.',
        'Distribuição dos estágios do sono por noite e como a composição varia semana a semana.',
        vTiles(sTiles) +
        vCanvasCard('vSleepStageChart', 'Sleep stage distribution — boxplot (±1.5 × IQR)', 'Distribuição dos estágios do sono — boxplot (±1,5 × IIQ)',
          'Hours per night · n=' + nNights + ' nights', 'Horas por noite · n=' + nNights + ' noites') +
        '<div class="two-col">' +
        vPlotCard('vSleepTotalChart', 'Total sleep — weekly average (hours per night)', 'Sono total — média semanal (horas por noite)',
          '7–9 h adult-guidance band · n=' + sleepStagesByWeek.length + ' weeks', 'Faixa recomendada 7–9 h · n=' + sleepStagesByWeek.length + ' semanas') +
        vPlotCard('vSleepCompositionChart', 'Sleep stage composition — weekly average (% of total sleep)', 'Composição dos estágios — média semanal (% do sono total)',
          '100% stacked · deep + REM + light + awake', '100% empilhado · profundo + REM + leve + acordado') +
        '</div>');

      /* 2a — boxplot (Chart.js) */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vSleepStageChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        var order = [
          { key: 'deep',  en: 'Deep',  pt: 'Profundo', fill: C.blue600, stroke: C.blue800 },
          { key: 'rem',   en: 'REM',   pt: 'REM',      fill: C.blue500, stroke: C.blue700 },
          { key: 'light', en: 'Light', pt: 'Leve',     fill: C.blue400, stroke: C.blue600 },
          { key: 'awake', en: 'Awake', pt: 'Acordado', fill: C.blue200, stroke: C.blue400 },
          { key: 'total', en: 'Total', pt: 'Total',    fill: C.blue900, stroke: '#0B1A28' },
        ].filter(function (s) { return stageHasData(sleepBox[s.key]); });
        _vitalsChartInstances.push(new Chart(el, {
          type: 'boxplot',
          data: {
            labels: order.map(function (s) { return L(s.en, s.pt); }),
            datasets: [{
              label: L('Hours per night', 'Horas por noite'),
              backgroundColor: order.map(function (s) { return s.fill; }),
              borderColor: order.map(function (s) { return s.stroke; }),
              borderWidth: 1.25, itemRadius: 0, meanRadius: 0, outlierRadius: 3,
              outlierBackgroundColor: order.map(function (s) { return s.stroke; }),
              outlierBorderColor: order.map(function (s) { return s.stroke; }),
              medianColor: '#1C2B2F',
              data: order.map(function (s) { return sleepBox[s.key]; }),
            }]
          },
          options: {
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: function (items) { return items[0].label + L(' sleep', ' · sono'); },
                  label: function (ctx) {
                    var v = ctx.parsed;
                    return [
                      L('Median:', 'Mediana:') + '   ' + vHm(v.median),
                      L('IQR:', 'IIQ:') + '      ' + vHm(v.q1) + ' – ' + vHm(v.q3),
                      L('Whiskers:', 'Hastes:') + ' ' + vHm(v.min) + ' – ' + vHm(v.max),
                      L('Mean:', 'Média:') + '     ' + vHm(v.mean),
                    ];
                  }
                }
              }
            },
            scales: {
              x: Object.assign({}, vAxisCommon, { ticks: Object.assign({}, vAxisCommon.ticks, { font: { size: 12 } }) }),
              y: Object.assign({}, vAxisCommon, {
                beginAtZero: true,
                title: { display: true, text: L('hours per night', 'horas por noite'), color: C.inkSoft },
                ticks: Object.assign({}, vAxisCommon.ticks, { callback: function (v) { return v + 'h'; } })
              })
            }
          }
        }));
      });

      /* 2b — weekly total-sleep spline (Plotly) */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vSleepTotalChart'); if (!el || typeof Plotly === 'undefined') return;
        var xs = sleepStagesByWeek.map(function (r) { return r.week; });
        var ys = sleepStagesByWeek.map(function (r) { return r.tst; });
        var ns = sleepStagesByWeek.map(function (r) { return r.n; });
        var trace = {
          x: xs, y: ys, type: 'scatter', mode: 'lines+markers',
          line: { color: '#0B1A28', width: 2.5, shape: 'spline' },
          marker: { color: '#0B1A28', size: 5 },
          fill: 'tozeroy', fillcolor: 'rgba(18,42,61,0.14)',
          customdata: ns,
          hovertemplate: L('Week of %{x}<br>Total sleep <b>%{y:.1f} h</b> · n=%{customdata} nights<extra></extra>',
                           'Semana de %{x}<br>Sono total <b>%{y:.1f} h</b> · n=%{customdata} noites<extra></extra>'),
          showlegend: false
        };
        var refLines = [
          { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 7, y1: 7, line: { color: '#C29327', width: 1, dash: 'dot' } },
          { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 9, y1: 9, line: { color: '#C29327', width: 1, dash: 'dot' } },
        ];
        Plotly.newPlot(el, [trace], vPlotLayout({
          shapes: refLines,
          xaxis: { type: 'date', showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } },
          yaxis: { title: { text: L('hours per night', 'horas por noite'), font: { color: C.inkSoft } }, rangemode: 'tozero', showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } }
        }), VPLOT_CONFIG);
      });

      /* 2c — weekly stage composition, 100% stacked area (Plotly) */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vSleepCompositionChart'); if (!el || typeof Plotly === 'undefined') return;
        var xs = sleepStagesByWeek.map(function (r) { return r.week; });
        var ns = sleepStagesByWeek.map(function (r) { return r.n; });
        var stages = [
          { key: 'deep',  en: 'Deep',  pt: 'Profundo', fill: 'rgba(47,100,137,0.80)',  stroke: '#1B3B54' },
          { key: 'rem',   en: 'REM',   pt: 'REM',      fill: 'rgba(62,124,163,0.80)',  stroke: '#244E6E' },
          { key: 'light', en: 'Light', pt: 'Leve',     fill: 'rgba(94,151,188,0.80)',  stroke: '#2F6489' },
          { key: 'awake', en: 'Awake', pt: 'Acordado', fill: 'rgba(181,210,229,0.80)', stroke: '#5E97BC' },
        ];
        var traces = stages.map(function (s) {
          return {
            x: xs, y: sleepStagesByWeek.map(function (r) { return r[s.key]; }),
            name: L(s.en, s.pt), type: 'scatter', mode: 'lines', stackgroup: 'one',
            line: { color: s.stroke, width: 1.7 }, fillcolor: s.fill, customdata: ns,
            hovertemplate: L('Week of %{x}<br>' + s.en + ' <b>%{y:.1f}%</b> · n=%{customdata} nights<extra></extra>',
                             'Semana de %{x}<br>' + s.pt + ' <b>%{y:.1f}%</b> · n=%{customdata} noites<extra></extra>')
          };
        });
        Plotly.newPlot(el, traces, vPlotLayout({
          xaxis: { type: 'date', showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } },
          yaxis: { title: { text: L('% of total sleep', '% do sono total'), font: { color: C.inkSoft } }, range: [0, 100], showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } }
        }), VPLOT_CONFIG);
      });
    }

    /* ── 3 · Movement ───────────────────────────────────────────────────── */
    if (hasMovement) {
      num++;
      addNav('vit-movement', 'Movement', 'Movimento');
      var stepVals = vNums(steps, function (r) { return r[1]; });
      var over10k = stepVals.filter(function (v) { return v >= 10000; }).length;
      var over5k = stepVals.filter(function (v) { return v >= 5000; }).length;
      parts['movement'] = vSection(num, 'vit-movement', 'Movement', 'Movimento',
        'Daily step count across every recorded day, with the weekly-median trend overlaid.',
        'Contagem de passos em cada dia registrado, com a tendência mediana semanal sobreposta.',
        vTiles([
          { label: t('Median steps/day', 'Passos/dia (mediana)'), value: Math.round(vMedian(stepVals)).toLocaleString() },
          { label: t('Mean steps/day', 'Passos/dia (média)'), value: Math.round(vMean(stepVals)).toLocaleString() },
          { label: t('Days ≥ 10k', 'Dias ≥ 10k'), value: String(over10k) },
          { label: t('Days ≥ 5k', 'Dias ≥ 5k'), value: String(over5k) },
        ]) +
        vCanvasCard('vStepsChart', 'Daily steps — every recorded day', 'Passos diários — cada dia registrado',
          'Pale bars = daily · line = weekly median · n=' + steps.length + ' days',
          'Barras claras = diário · linha = mediana semanal · n=' + steps.length + ' dias'));

      _vitalsBuilders.push(function () {
        var el = document.getElementById('vStepsChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        var buckets = {};
        steps.forEach(function (r) { (buckets[vIsoMonday(r[0])] = buckets[vIsoMonday(r[0])] || []).push(r[1]); });
        var weeklyMed = {};
        for (var w in buckets) weeklyMed[w] = Math.round(vMedian(buckets[w]));
        var medianSeries = steps.map(function (r) { return weeklyMed[vIsoMonday(r[0])]; });
        _vitalsChartInstances.push(new Chart(el, {
          type: 'bar',
          data: {
            labels: steps.map(function (r) { return r[0]; }),
            datasets: [
              { type: 'bar', label: L('Steps', 'Passos'), data: steps.map(function (r) { return r[1]; }),
                backgroundColor: 'rgba(139, 184, 210, 0.25)', borderColor: 'rgba(139, 184, 210, 0.55)',
                borderWidth: 1, borderRadius: 1, barPercentage: 0.95, categoryPercentage: 1.0 },
              { type: 'line', label: L('Weekly median', 'Mediana semanal'), data: medianSeries,
                borderColor: C.blue700, borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0, stepped: 'middle' }
            ]
          },
          options: {
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: {
                title: function (items) { return items[0].label; },
                label: function (ctx) {
                  return ctx.datasetIndex === 0
                    ? L(ctx.parsed.y.toLocaleString() + ' steps', ctx.parsed.y.toLocaleString() + ' passos')
                    : L('Weekly median: ' + ctx.parsed.y.toLocaleString(), 'Mediana semanal: ' + ctx.parsed.y.toLocaleString());
                }
              } }
            },
            scales: {
              x: Object.assign({}, vAxisCommon, { ticks: Object.assign({}, vAxisCommon.ticks, { maxTicksLimit: 14, maxRotation: 0 }) }),
              y: Object.assign({}, vAxisCommon, { beginAtZero: true,
                title: { display: true, text: L('steps / day', 'passos / dia'), color: C.inkSoft },
                ticks: Object.assign({}, vAxisCommon.ticks, { callback: function (v) { return (v / 1000) + 'k'; } }) })
            }
          }
        }));
      });
    }

    /* ── 4 · Cardiovascular & recovery ──────────────────────────────────── */
    if (hasCardio) {
      num++;
      addNav('vit-cardio', 'Cardiovascular & recovery', 'Cardiovascular e recuperação');
      var hrvVals = vNums(hrvRhr, function (r) { return r[1]; });
      var rhrVals = vNums(hrvRhr, function (r) { return r[2]; });
      var cTiles = [];
      if (rhrVals.length) cTiles.push({ label: t('Resting HR (median)', 'FC repouso (mediana)'), value: vFmt(vMedian(rhrVals), 0), unit: 'bpm' });
      if (hrvVals.length) cTiles.push({ label: t('HRV (median)', 'VFC (mediana)'), value: vFmt(vMedian(hrvVals), 0), unit: 'ms' });
      if (hrvVals.length) cTiles.push({ label: t('HRV (mean)', 'VFC (média)'), value: vFmt(vMean(hrvVals), 1), unit: 'ms' });
      var cardioBody = vTiles(cTiles) +
        vCanvasCard('vCardioChart', 'HRV & resting HR — monthly mean', 'VFC e FC em repouso — média mensal',
          'HRV (ms, left) · resting HR (bpm, right) · per-night source', 'VFC (ms, esq.) · FC repouso (bpm, dir.) · fonte por noite');
      if (hasHrTod || hasRhrWeek) {
        cardioBody += (hasHrTod && hasRhrWeek) ? '<div class="two-col">' : '';
        if (hasHrTod) {
          cardioBody += vPlotCard('vHrPatternsChart', 'Daily patterns — heart rate by time of day', 'Padrões diários — frequência cardíaca por hora do dia',
            'All readings folded onto 24 h · median · ±1 SD · ±2 SD', 'Todas as leituras dobradas em 24 h · mediana · ±1 DP · ±2 DP');
        }
        if (hasRhrWeek) {
          cardioBody += vPlotCard('vRhrTimelineChart', 'Resting HR — weekly timeline', 'FC em repouso — linha do tempo semanal',
            '50–65 bpm healthy band · gaps not bridged', 'Faixa saudável 50–65 bpm · lacunas não interligadas');
        }
        cardioBody += (hasHrTod && hasRhrWeek) ? '</div>' : '';
      }
      parts['cardiovascular'] = vSection(num, 'vit-cardio', 'Cardiovascular & recovery', 'Cardiovascular e recuperação',
        'Heart-rate variability, resting heart rate and their daily and weekly rhythm.',
        'Variabilidade da frequência cardíaca, FC em repouso e seu ritmo diário e semanal.',
        cardioBody);

      /* 4a — HRV/RHR monthly-mean dual axis (Chart.js) */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vCardioChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        var buckets = {};
        hrvRhr.forEach(function (row) {
          var m = row[0].slice(0, 7);
          if (!buckets[m]) buckets[m] = { hrv: [], rhr: [] };
          if (row[1] != null) buckets[m].hrv.push(row[1]);
          if (row[2] != null) buckets[m].rhr.push(row[2]);
        });
        var months = Object.keys(buckets).sort();
        var hrvSeries = months.map(function (m) { var v = vMean(buckets[m].hrv); return v == null ? null : +v.toFixed(1); });
        var rhrSeries = months.map(function (m) { var v = vMean(buckets[m].rhr); return v == null ? null : +v.toFixed(1); });
        _vitalsChartInstances.push(new Chart(el, {
          type: 'line',
          data: {
            labels: months.map(vFmtMonth),
            datasets: [
              { label: L('HRV (ms)', 'VFC (ms)'), data: hrvSeries, borderColor: C.blue600, backgroundColor: 'rgba(94,151,188,0.20)', tension: 0.35, yAxisID: 'y', fill: true, borderWidth: 2, pointRadius: 4, pointBackgroundColor: C.blue600, spanGaps: true },
              { label: L('Resting HR (bpm)', 'FC em repouso (bpm)'), data: rhrSeries, borderColor: C.red500, backgroundColor: 'transparent', tension: 0.35, yAxisID: 'y1', borderWidth: 2, borderDash: [4, 4], pointRadius: 4, pointBackgroundColor: C.red500, spanGaps: true }
            ]
          },
          options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { color: C.inkSoft } } },
            scales: {
              y:  Object.assign({}, vAxisCommon, { position: 'left', title: { display: true, text: L('HRV (ms)', 'VFC (ms)'), color: C.inkSoft } }),
              y1: Object.assign({}, vAxisCommon, { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: L('RHR (bpm)', 'FC rep. (bpm)'), color: C.inkSoft } }),
              x:  Object.assign({}, vAxisCommon)
            }
          }
        }));
      });

      /* 4b — HR by time of day, pattern chart (Plotly, red palette) */
      if (hasHrTod) {
        _vitalsBuilders.push(function () {
          var el = document.getElementById('vHrPatternsChart'); if (!el || typeof Plotly === 'undefined') return;
          var N = hrByTod.length;
          var W = 3;
          var med = vSmoothCirc(hrByTod.map(function (r) { return r[1]; }), W);
          var m1 = vSmoothCirc(hrByTod.map(function (r) { return r[2]; }), W);
          var sd1 = vSmoothCirc(hrByTod.map(function (r) { return r[3]; }), W);
          var xs = Array.from({ length: N }, function (_, i) { return i * 5; });
          var traces = vBandTraces(xs, m1, sd1, 'rgba(220, 89, 89, 0.22)', 'rgba(165, 48, 48, 0.42)');
          traces.push({
            x: xs, y: med, type: 'scatter', mode: 'lines',
            line: { color: '#5E1D1D', width: 2.5, shape: 'spline' },
            customdata: vTodCustomData(xs),
            hovertemplate: L('%{customdata}<br>Median <b>%{y:.0f} bpm</b><extra></extra>',
                             '%{customdata}<br>Mediana <b>%{y:.0f} bpm</b><extra></extra>'),
            showlegend: false
          });
          var refLines = [
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 80, y1: 80, line: { color: '#3D9460', width: 1.2 } },
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 100, y1: 100, line: { color: '#C29327', width: 1.2, dash: 'dot' } },
          ];
          Plotly.newPlot(el, traces, vPlotLayout({
            shapes: refLines,
            xaxis: vTodAxis(),
            yaxis: { title: { text: 'bpm', font: { color: C.inkSoft } }, showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } }
          }), VPLOT_CONFIG);
        });
      }

      /* 4c — RHR weekly timeline (Plotly, gaps not bridged) */
      if (hasRhrWeek) {
        _vitalsBuilders.push(function () {
          var el = document.getElementById('vRhrTimelineChart'); if (!el || typeof Plotly === 'undefined') return;
          var xs = [], ys = [], ns = [];
          var WEEK_MS = 7 * 24 * 3600 * 1000;
          rhrByWeek.forEach(function (r, i) {
            if (i > 0) {
              var prev = Date.parse(rhrByWeek[i - 1].week);
              if (Date.parse(r.week) - prev > WEEK_MS) { xs.push(r.week); ys.push(null); ns.push(null); }
            }
            xs.push(r.week); ys.push(r.rhr); ns.push(r.n);
          });
          var trace = {
            x: xs, y: ys, type: 'scatter', mode: 'lines',
            line: { color: '#5E1D1D', width: 2 }, connectgaps: false, customdata: ns,
            hovertemplate: L('Week of %{x}<br>Resting HR <b>%{y:.1f} bpm</b> · n=%{customdata} days<extra></extra>',
                             'Semana de %{x}<br>FC em repouso <b>%{y:.1f} bpm</b> · n=%{customdata} dias<extra></extra>'),
            showlegend: false
          };
          var refLines = [
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 50, y1: 50, line: { color: '#C29327', width: 1, dash: 'dot' } },
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 65, y1: 65, line: { color: '#C29327', width: 1, dash: 'dot' } },
          ];
          Plotly.newPlot(el, [trace], vPlotLayout({
            shapes: refLines,
            xaxis: { type: 'date', showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } },
            yaxis: { title: { text: 'bpm', font: { color: C.inkSoft } }, showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } }
          }), VPLOT_CONFIG);
        });
      }
    }

    /* ── 5 · Stress & resilience ────────────────────────────────────────── */
    if (hasStress) {
      num++;
      addNav('vit-stress', 'Stress & resilience', 'Estresse e resiliência');
      var stressVals = vNums(stressRes, function (r) { return r[1]; });
      var scoreVals = vNums(stressRes, function (r) { return r[3]; });
      var stTiles = [];
      if (stressVals.length) stTiles.push({ label: t('High-stress (median)', 'Alto estresse (mediana)'), value: vFmt(vMedian(stressVals), 0), unit: 'min/day' });
      if (scoreVals.length) stTiles.push({ label: t('Resilience (median)', 'Resiliência (mediana)'), value: vFmt(vMedian(scoreVals), 0) });
      if (scoreVals.length) stTiles.push({ label: t('Resilience (mean)', 'Resiliência (média)'), value: vFmt(vMean(scoreVals), 0) });
      parts['stress-resilience'] = vSection(num, 'vit-stress', 'Stress & resilience', 'Estresse e resiliência',
        'Daily high-stress load and the composite resilience score, each with a 7-day rolling mean.',
        'Carga diária de alto estresse e a pontuação composta de resiliência, cada uma com média móvel de 7 dias.',
        vTiles(stTiles) +
        vCanvasCard('vStressChart', 'Stress load & resilience — daily with 7-day mean', 'Estresse e resiliência — diário com média de 7 dias',
          'High-stress min/day (red, left) · resilience 0–100 (green, right)', 'Alto estresse min/dia (verm., esq.) · resiliência 0–100 (verde, dir.)'));

      _vitalsBuilders.push(function () {
        var el = document.getElementById('vStressChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        var labels = stressRes.map(function (r) { return r[0]; });
        var stress = stressRes.map(function (r) { return (typeof r[1] === 'number' ? r[1] : null); });
        var score = stressRes.map(function (r) { return (typeof r[3] === 'number' ? r[3] : null); });
        var stressMA = vRolling(stress, 7);
        var scoreMA = vRolling(score, 7);
        _vitalsChartInstances.push(new Chart(el, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              { label: L('High-stress (min/day)', 'Alto estresse (min/dia)'), data: stress, borderColor: 'rgba(199,62,62,0.28)', backgroundColor: 'rgba(199,62,62,0.06)', tension: 0.25, yAxisID: 'y', fill: true, borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, pointHoverBackgroundColor: C.red500 },
              { label: L('High-stress · 7-day mean', 'Alto estresse · média 7 dias'), data: stressMA, borderColor: C.red500, backgroundColor: 'transparent', tension: 0.35, yAxisID: 'y', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: C.red500 },
              { label: L('Resilience score (0–100)', 'Pontuação de resiliência (0–100)'), data: score, borderColor: 'rgba(61,148,96,0.30)', backgroundColor: 'transparent', tension: 0.25, yAxisID: 'y1', borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, pointHoverBackgroundColor: C.green500 },
              { label: L('Resilience · 7-day mean', 'Resiliência · média 7 dias'), data: scoreMA, borderColor: C.green500, backgroundColor: 'transparent', tension: 0.35, yAxisID: 'y1', borderWidth: 2.5, borderDash: [5, 3], pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: C.green500 }
            ]
          },
          options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'bottom', labels: { color: C.inkSoft, boxWidth: 18 } },
              tooltip: { callbacks: {
                afterBody: function (items) {
                  var row = stressRes[items[0].dataIndex]; var bits = [];
                  if (row[4]) bits.push(L('level:', 'nível:') + ' ' + row[4]);
                  if (row[5]) bits.push(L('summary:', 'resumo:') + ' ' + row[5]);
                  return bits.length ? bits.join(' · ') : '';
                }
              } }
            },
            scales: {
              y:  Object.assign({}, vAxisCommon, { position: 'left', beginAtZero: true, title: { display: true, text: L('High-stress (min/day)', 'Alto estresse (min/dia)'), color: C.inkSoft } }),
              y1: Object.assign({}, vAxisCommon, { position: 'right', grid: { drawOnChartArea: false }, min: 0, max: 100, title: { display: true, text: L('Resilience score', 'Pontuação de resiliência'), color: C.inkSoft }, ticks: Object.assign({}, vAxisCommon.ticks, { stepSize: 20 }) }),
              x:  Object.assign({}, vAxisCommon, { ticks: Object.assign({}, vAxisCommon.ticks, { autoSkip: true, maxTicksLimit: 12, maxRotation: 0, callback: function (value) { var lbl = this.getLabelForValue(value); return lbl ? lbl.slice(0, 7) : lbl; } }) })
            }
          }
        }));
      });
    }

    /* ── 6 · Blood pressure ─────────────────────────────────────────────── */
    if (hasBp) {
      num++;
      addNav('vit-bp', 'Blood pressure', 'Pressão arterial');
      var sysVals = vNums(bp, function (r) { return r[1]; });
      var diaVals = vNums(bp, function (r) { return r[2]; });
      var last = bp[bp.length - 1];
      var bpBody = vTiles([
        { label: t('Systolic (mean)', 'Sistólica (média)'), value: vFmt(vMean(sysVals), 0), unit: 'mmHg' },
        { label: t('Systolic (peak)', 'Sistólica (pico)'), value: String(Math.max.apply(null, sysVals)), unit: 'mmHg' },
        { label: t('Diastolic (mean)', 'Diastólica (média)'), value: vFmt(vMean(diaVals), 0), unit: 'mmHg' },
        { label: t('Diastolic (peak)', 'Diastólica (pico)'), value: String(Math.max.apply(null, diaVals)), unit: 'mmHg' },
        { label: t('Latest', 'Última'), value: (last[1] + '/' + last[2]), unit: 'mmHg' },
      ]) +
        vCanvasCard('vBpChart', 'Blood pressure — monthly mean', 'Pressão arterial — média mensal',
          'Systolic & diastolic · n=' + bp.length + ' readings', 'Sistólica e diastólica · n=' + bp.length + ' leituras') +
        vCanvasCard('vBpDailyChart', 'Daily readings — full timeline', 'Leituras diárias — linha do tempo completa',
          'Every reading · colour-coded by ACC/AHA 2017 category', 'Cada leitura · colorida por categoria ACC/AHA 2017', 'tall');
      if (hasBpWeek) {
        bpBody += vPlotCard('vBpPatternsChart', 'Blood pressure — weekly variability', 'Pressão arterial — variabilidade semanal',
          'Systolic (red) · diastolic (blue) · median ± SD · AHA stage lines', 'Sistólica (verm.) · diastólica (azul) · mediana ± DP · linhas de estágio AHA');
      }
      parts['blood-pressure'] = vSection(num, 'vit-bp', 'Blood pressure', 'Pressão arterial',
        'Monthly mean systolic and diastolic pressure, with the week-to-week spread when available.',
        'Média mensal de pressão sistólica e diastólica, com a dispersão semanal quando disponível.',
        bpBody);

      /* 6a — monthly-mean grouped bars (Chart.js) */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vBpChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        var buckets = {};
        bp.forEach(function (row) {
          var m = row[0].slice(0, 7);
          if (!buckets[m]) buckets[m] = { sys: [], dia: [] };
          buckets[m].sys.push(row[1]); buckets[m].dia.push(row[2]);
        });
        var months = Object.keys(buckets).sort();
        var sysM = months.map(function (m) { return +vMean(buckets[m].sys).toFixed(1); });
        var diaM = months.map(function (m) { return +vMean(buckets[m].dia).toFixed(1); });
        _vitalsChartInstances.push(new Chart(el, {
          type: 'bar',
          data: {
            labels: months.map(vFmtMonth),
            datasets: [
              { label: L('Systolic (mmHg)', 'Sistólica (mmHg)'), data: sysM, backgroundColor: C.blue300, borderColor: C.blue600, borderWidth: 1, borderRadius: 3 },
              { label: L('Diastolic (mmHg)', 'Diastólica (mmHg)'), data: diaM, backgroundColor: C.blue700, borderColor: C.blue900, borderWidth: 1, borderRadius: 3 }
            ]
          },
          options: {
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { color: C.inkSoft } },
              tooltip: { callbacks: { afterLabel: function (ctx) { var m = months[ctx.dataIndex]; return L('n = ' + buckets[m].sys.length + ' readings', 'n = ' + buckets[m].sys.length + ' leituras'); } } }
            },
            scales: {
              x: Object.assign({}, vAxisCommon),
              y: Object.assign({}, vAxisCommon, { beginAtZero: false, suggestedMin: 60, suggestedMax: 160, title: { display: true, text: 'mmHg', color: C.inkSoft } })
            }
          }
        }));
      });

      /* 6b — daily readings, full timeline (Withings-style floating bars:
         thin pill from diastolic to systolic with hollow circles at each
         end, colour-coded by ACC/AHA 2017 category). One continuous chart
         across all dates — no month navigation. */
      _vitalsBuilders.push(function () {
        var el = document.getElementById('vBpDailyChart'); if (!el) return;
        if (Chart.getChart(el)) Chart.getChart(el).destroy();
        function bpColor(sys, dia) {
          if (sys >= 180 || dia >= 120) return '#7A1F1F'; // crisis
          if (sys >= 140 || dia >= 90) return '#C0392B';  // Stage 2
          if (sys >= 130 || dia >= 80) return '#D88B3A';  // Stage 1
          if (sys >= 120) return '#E5C04A';               // Elevated
          return '#3F8A4D';                                // Normal
        }
        var labels = bp.map(function (r) { return r[0]; });
        var pts = bp.map(function (r) { return { x: r[0], y: [r[2], r[1]], sys: r[1], dia: r[2] }; });
        var colors = bp.map(function (r) { return bpColor(r[1], r[2]); });
        var months = vMonthNames();
        function fmtShort(iso) { return months[parseInt(iso.slice(5, 7), 10) - 1] + ' ' + parseInt(iso.slice(8, 10), 10); }
        function tickFormatter(value, index) {
          var iso = labels[index]; if (!iso) return '';
          var prev = index > 0 ? labels[index - 1] : null;
          var isFirst = !prev || prev.slice(0, 7) !== iso.slice(0, 7);
          return isFirst ? months[parseInt(iso.slice(5, 7), 10) - 1] + ' ' + iso.slice(2, 4) : '';
        }
        var endpointCirclesPlugin = {
          id: 'vBpEndpointCircles',
          afterDatasetsDraw: function (chart) {
            var ds = chart.data.datasets[0]; if (!ds || !ds.data) return;
            var ctx = chart.ctx, x = chart.scales.x, y = chart.scales.y;
            ds.data.forEach(function (pt, i) {
              if (!pt || !Array.isArray(pt.y)) return;
              var xPx = x.getPixelForValue(pt.x);
              var yLow = y.getPixelForValue(pt.y[0]), yHigh = y.getPixelForValue(pt.y[1]);
              var color = Array.isArray(ds.borderColor) ? ds.borderColor[i] : ds.borderColor;
              ctx.save(); ctx.lineWidth = 1.4; ctx.strokeStyle = color; ctx.fillStyle = '#FFFFFF';
              var r = 3.4;
              ctx.beginPath(); ctx.arc(xPx, yHigh, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.beginPath(); ctx.arc(xPx, yLow, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.restore();
            });
          }
        };
        _vitalsChartInstances.push(new Chart(el, {
          type: 'bar',
          data: { labels: labels, datasets: [{ label: 'BP', data: pts, borderColor: colors, backgroundColor: 'transparent', borderWidth: 1.5, borderRadius: 8, borderSkipped: false, barThickness: 5 }] },
          options: {
            maintainAspectRatio: false, responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: { displayColors: false, callbacks: {
                title: function (items) { return fmtShort(items[0].label); },
                label: function (item) { return item.raw.sys + ' / ' + item.raw.dia + ' mmHg'; }
              } }
            },
            scales: {
              x: { type: 'category', grid: { display: false }, ticks: { color: C.inkSoft, autoSkip: false, maxRotation: 0, font: { size: 11 }, callback: tickFormatter } },
              y: Object.assign({}, vAxisCommon, { min: 50, max: 180, ticks: Object.assign({}, vAxisCommon.ticks, { stepSize: 25 }), title: { display: true, text: 'mmHg', color: C.inkSoft } })
            }
          },
          plugins: [endpointCirclesPlugin]
        }));
      });

      /* 6c — weekly variability pattern (Plotly, sys red / dia blue) */
      if (hasBpWeek) {
        _vitalsBuilders.push(function () {
          var el = document.getElementById('vBpPatternsChart'); if (!el || typeof Plotly === 'undefined') return;
          var xs = bpByWeek.map(function (r) { return r[0]; });
          var sysMed = bpByWeek.map(function (r) { return r[2]; });
          var sysMean = bpByWeek.map(function (r) { return r[3]; });
          var sysSd = bpByWeek.map(function (r) { return r[4]; });
          var diaMed = bpByWeek.map(function (r) { return r[5]; });
          var diaMean = bpByWeek.map(function (r) { return r[6]; });
          var diaSd = bpByWeek.map(function (r) { return r[7]; });
          var ns = bpByWeek.map(function (r) { return r[1]; });
          var traces = vBandTraces(xs, sysMean, sysSd, 'rgba(220, 89, 89, 0.20)', 'rgba(165, 48, 48, 0.38)');
          traces.push({
            x: xs, y: sysMed, type: 'scatter', mode: 'lines+markers',
            line: { color: '#5E1D1D', width: 2.5, shape: 'spline' }, marker: { color: '#5E1D1D', size: 5 }, customdata: ns,
            hovertemplate: L('Week of %{x}<br>Systolic median <b>%{y:.0f}</b> · n=%{customdata}<extra></extra>',
                             'Semana de %{x}<br>Mediana sistólica <b>%{y:.0f}</b> · n=%{customdata}<extra></extra>'),
            showlegend: false
          });
          Array.prototype.push.apply(traces, vBandTraces(xs, diaMean, diaSd, 'rgba(94, 151, 188, 0.20)', 'rgba(47, 100, 137, 0.38)'));
          traces.push({
            x: xs, y: diaMed, type: 'scatter', mode: 'lines+markers',
            line: { color: '#1B3B54', width: 2.5, shape: 'spline' }, marker: { color: '#1B3B54', size: 5 }, customdata: ns,
            hovertemplate: L('Week of %{x}<br>Diastolic median <b>%{y:.0f}</b> · n=%{customdata}<extra></extra>',
                             'Semana de %{x}<br>Mediana diastólica <b>%{y:.0f}</b> · n=%{customdata}<extra></extra>'),
            showlegend: false
          });
          var refLines = [
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 140, y1: 140, line: { color: '#A53030', width: 1, dash: 'dot' } },
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 130, y1: 130, line: { color: '#C29327', width: 1, dash: 'dot' } },
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 90,  y1: 90,  line: { color: '#A53030', width: 1, dash: 'dot' } },
            { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 80,  y1: 80,  line: { color: '#C29327', width: 1, dash: 'dot' } },
          ];
          Plotly.newPlot(el, traces, vPlotLayout({
            shapes: refLines,
            xaxis: { type: 'date', showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } },
            yaxis: { title: { text: 'mmHg', font: { color: C.inkSoft } }, showgrid: true, gridcolor: C.grid, zeroline: false, tickfont: { color: C.inkSoft } }
          }), VPLOT_CONFIG);
        });
      }
    }

    /* ── In-page section nav (one anchor per rendered section) ───────────── *
     * DELIBERATELY its own classes, NOT .section-nav/.section-nav-inner: this
     * page's <body class="has-side-nav"> restyles those exact class names via
     * DESCENDANT selectors (body.has-side-nav .section-nav-inner { flex-
     * direction:column }, body.has-side-nav .section-nav a { color: rgba(255,
     * 255,255,.66) }) that match at ANY nesting depth — while the FIXED-
     * SIDEBAR positioning those rules assume only applies via the CHILD
     * combinator (body.has-side-nav > .section-nav), which this nav (nested
     * inside .ov-shell, not a direct child of body) never matches. The result
     * was a sticky, vertically-stacked, near-white-on-white nav card ~300px
     * tall stuck to the top of the viewport while scrolling. Injecting our own
     * scoped rule set (mirrors the plain horizontal-pill .section-nav look)
     * sidesteps that cascade entirely. */
    injectVitalsNavStyle();
    var navHtml = '<div class="vit-nav"><div class="vit-nav-inner">' +
      nav.map(function (s) { return '<a href="#' + s.id + '">' + t(s.en, s.pt) + '</a>'; }).join('') +
      '</div></div>';

    /* Top metric grid — kept always-positive (breakdown.vitals_days can be 0
       for front-end-only patients whose data lives only behind the API). */
    var nights = (d.meta && d.meta.nights) || 0;
    var hrReadings = (d.meta && d.meta.hrReadings) || 0;
    var topMetrics = [
      { label: t('Vitals days', 'Dias de vitais'), value: b.vitals_days || steps.length || num },
      { label: t('ECG events', 'Eventos de ECG'), value: b.ecg_events || 0 },
    ];
    if (nights) topMetrics.push({ label: t('Sleep nights', 'Noites de sono'), value: nights });
    if (hrReadings) topMetrics.push({ label: t('HR readings', 'Leituras de FC'), value: hrReadings });

    /* Re-render every chart when the language toggle flips so baked-in
       Chart.js / Plotly strings switch language. Registered once. */
    if (!_vitalsLangHooked) {
      _vitalsLangHooked = true;
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.lang-btn');
        if (btn) setTimeout(runVitalsBuilders, 0);
      });
    }

    return {
      parts: parts,
      order: order,
      navHtml: navHtml,
      topMetricsHtml: renderMetricGrid(topMetrics),
    };
  }

  // Build the psychological-architecture HTML (archetype card + AMPD dimension
  // panels + life-events timeline) from /api/patient-psych, reusing mental.html's
  // existing CSS classes. Synthesis/quote text is model-authored EN — rendered in
  // plain spans (visible under both language toggles) so there are no blank PT gaps;
  // only the section/dimension headers are bilingual.
  var LIFE_FLAG_CATS = { crisis: 1, hospitalization: 1, loss: 1, diagnosis: 1, divorce: 1 };
  function psychArchitectureHtml(psych) {
    var out = '';
    var a = psych.archetype;
    if (a) {
      out +=
        '<section class="report-section"><div class="container"><div class="archetype-card">' +
          '<div class="archetype-eyebrow">' +
            '<span class="lang-en">Psychological archetype · Jungian read</span>' +
            '<span class="lang-pt">Arquétipo psicológico · leitura junguiana</span>' +
            '<span class="ai-pill ai-pill--inverse"><span class="lang-en">AI inference</span><span class="lang-pt">Inferência por IA</span></span>' +
          '</div>' +
          '<h2 class="archetype-name">' + escapeHtml(a.title.replace(/^jungian archetype:\s*/i, '')) + '</h2>' +
          '<p class="archetype-frame">' + escapeHtml(a.synthesis).replace(/\n+/g, '</p><p class="archetype-frame">') + '</p>' +
          (a.evidence || []).slice(0, 3).map(function (e) {
            return '<blockquote class="archetype-quote"><span>' + escapeHtml(e.quote) + '</span>' +
              (e.citation ? '<cite>' + escapeHtml(e.citation) + '</cite>' : '') + '</blockquote>';
          }).join('') +
        '</div></div></section>';
    }
    if (psych.dimensions && psych.dimensions.length) {
      out += '<section class="report-section"><div class="container">' +
        '<h2 class="section-title"><span class="lang-en">Psychological architecture — synthesized from personal writings</span>' +
        '<span class="lang-pt">Arquitetura psicológica — sintetizada a partir de escritos pessoais</span>' +
        ' <span class="ai-pill"><span class="lang-en">AI</span><span class="lang-pt">IA</span></span></h2>';
      psych.dimensions.forEach(function (d) {
        if (!d.items || !d.items.length) return; // skip empty dimensions (I-5)
        out += '<div class="psych-dim-panel" data-dim="' + escapeHtml(d.id) + '">' +
          '<div class="psych-dim-panel-head">' +
            '<h3 class="psych-dim-panel-title"><span class="lang-en">' + escapeHtml(d.name_en) + '</span>' +
              '<span class="lang-pt">' + escapeHtml(d.name_pt || d.name_en) + '</span></h3>' +
            (d.blurb ? '<p class="psych-dim-panel-blurb"><span>' + escapeHtml(d.blurb) + '</span></p>' : '') +
          '</div>' +
          d.items.map(function (it) {
            return '<div class="psych-item">' +
              '<h4 class="psych-item-title"><span>' + escapeHtml(it.title) + '</span></h4>' +
              '<p class="psych-synthesis"><span>' + escapeHtml(it.synthesis) + '</span></p>' +
              ((it.evidence && it.evidence.length) ?
                '<ul class="psych-evidence">' + it.evidence.map(function (e) {
                  return '<li><span class="quote">' + escapeHtml(e.quote) + '</span>' +
                    (e.citation ? '<span class="citation">' + escapeHtml(e.citation) + '</span>' : '') + '</li>';
                }).join('') + '</ul>' : '') +
            '</div>';
          }).join('') +
        '</div>';
      });
      out += '</div></section>';
    }
    return out;
  }

  /* Life-events timeline as its own registry section (mental · life-history). */
  function psychLifeHistoryHtml(psych) {
    var le = (psych && psych.life_events) || [];
    if (!le.length) return '';
    return '<section class="report-section"><div class="container">' +
      '<h2 class="section-title"><span class="lang-en">A life in events</span><span class="lang-pt">Uma vida em eventos</span></h2>' +
      '<div class="timeline">' +
      le.map(function (e) {
        var flag = LIFE_FLAG_CATS[e.category] ? ' flag' : '';
        return '<div class="timeline-item' + flag + '">' +
          '<div class="timeline-date">' + escapeHtml(e.occurred_on || '') + '</div>' +
          '<div class="timeline-title"><span>' + escapeHtml(e.title) + '</span></div>' +
          (e.description ? '<div class="timeline-body"><span>' + escapeHtml(e.description) + '</span></div>' : '') +
        '</div>';
      }).join('') +
      '</div></div></section>';
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
      '.jc-overview { padding: 32px 24px 96px; background: #F9F7F4; }',
      // The home root carries BOTH classes; the compound selector outranks the
      // .jc-overview rule above regardless of order, so home stays unpadded
      // (full-bleed banner + report-section bands). Cascade-order bug fix.
      '.jc-overview.jc-home { padding: 0; }',
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
      // The in-card history block is a hidden data carrier now — clicking the
      // card opens the jc-labpop dialog instead of expanding in place.
      '.lab-test-history { display: none; }',
      // Lab history popup (table + time-series chart)
      '.jc-labpop-backdrop { position: fixed; inset: 0; background: rgba(13,27,42,0.45); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; }',
      '.jc-labpop { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 12px; box-shadow: 0 18px 60px rgba(13,27,42,0.28); width: min(1040px, 100%); max-height: min(84vh, 760px); display: flex; flex-direction: column; position: relative; padding: 20px 24px 22px; overflow: hidden; }',
      '.jc-labpop-close { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border-radius: 6px; border: 1px solid #E5E2DC; background: #FFFFFF; color: #7A8FA6; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.15s, border-color 0.15s; }',
      '.jc-labpop-close:hover { color: #0D1B2A; border-color: #B8954A; }',
      '.jc-labpop-head { padding-right: 40px; }',
      '.jc-labpop-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 18px; color: #0D1B2A; }',
      '.jc-labpop-title .lab-name-pt { font-weight: 300; color: #7A8FA6; font-size: 14px; }',
      '.jc-labpop-sub { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-top: 4px; letter-spacing: 0.03em; }',
      '.jc-labpop-sub .jc-labpop-ref .lab-test-ref { display: inline; }',
      '.jc-labpop-body { display: flex; gap: 22px; margin-top: 16px; min-height: 0; flex: 1 1 auto; align-items: stretch; overflow: hidden; }',
      '.jc-labpop-tablewrap { flex: 1 1 52%; min-width: 0; min-height: 0; overflow: auto; }',
      '.jc-labpop-body.jc-labpop-tableonly .jc-labpop-tablewrap { flex: 1 1 100%; }',
      '.jc-labpop-chartwrap { flex: 1 1 48%; min-width: 0; display: flex; flex-direction: column; justify-content: center; border-left: 1px solid #EFEBE3; padding-left: 22px; }',
      // Compact table metrics inside the popup so all four columns fit its pane
      '.jc-labpop .lab-test-history-table td { padding: 7px 6px; }',
      '.jc-labpop .lab-test-history-table th { padding: 4px 6px 8px; }',
      '.jc-labpop .lab-test-history-table .pill { white-space: nowrap; }',
      '.jc-labpop-chartwrap svg { width: 100%; height: auto; display: block; }',
      '.jc-labpop-legend { display: flex; gap: 16px; margin-top: 10px; font-family: "IBM Plex Sans", sans-serif; font-size: 11px; color: #7A8FA6; }',
      '.jc-labpop-key { display: inline-flex; align-items: center; gap: 6px; }',
      '.jc-labpop-key-dash { width: 16px; border-top: 2px dashed #ABBFE5; }',
      '.jc-labpop-key-dot { width: 8px; height: 8px; border-radius: 50%; background: #7A2E22; border: 1px solid #FFFFFF; box-shadow: 0 0 0 1px #7A2E22; }',
      'body.jc-labpop-open { overflow: hidden; }',
      '@media (max-width: 760px) { .jc-labpop-body { flex-direction: column; overflow-y: auto; } .jc-labpop-tablewrap { max-height: none; overflow-y: visible; } .jc-labpop-chartwrap { border-left: none; padding-left: 0; border-top: 1px solid #EFEBE3; padding-top: 16px; } }',
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
  /* ── Danger zone (Delete my health data) ─────────────────────────────
     Pure builder: returns the card element, never inserts itself. Placement
     is owned by the page assembler's tail (Upload → Update → Delete, home
     only per D3) — the old bottom-dock/reflow machinery is retired. ── */
  function buildDangerZone() {
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
    zone.querySelector('.jc-danger-btn').addEventListener('click', openDangerModal);
    return zone;
  }
  // Consumed by the assembler tail (page-assembler.js) on home pages.
  window.jcBuildDangerZone = buildDangerZone;

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

  /* ── Static-shell medications (DB-driven) ───────────────────────────────
     Fills the #meds pharmacology tables on Patient Zero's static physical.html
     from /api/patient-summary (medications + supplements) — the same pattern
     as the #injury tables on home.html. The DB is the source of truth
     (scripts/ingest-*-medications.mjs); the previously hardcoded rows went
     stale on every dose change. Shows the normalized DAILY dose; the note
     cell shows the first sentence (generic name), full note in the tooltip. */
  function decorateMedsFromDb(clerk) {
    var section = document.getElementById('meds');
    if (!section) return;
    var medsBody = document.getElementById('meds-db-body');
    var suppsBody = document.getElementById('supps-db-body');
    if (!medsBody && !suppsBody) return; // shell predates the DB-driven tbodies
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(clerk), {
      headers: { 'Accept': 'application/json', 'X-Viewer-Clerk': viewerClerkHeader() },
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (s) {
        var meds = (s && s.medications) || [];
        var supps = (s && s.supplements) || [];
        if (!meds.length && !supps.length) { section.style.display = 'none'; return; }
        if (medsBody) {
          medsBody.innerHTML = meds.map(function (m) {
            var daily = (m.daily_dose_amount != null && isFinite(Number(m.daily_dose_amount)))
              ? fmtLabNum(Number(m.daily_dose_amount)) + ' ' + escapeHtml(m.daily_dose_unit || '') + t('/day', '/dia')
              : (m.frequency ? escapeHtml(m.frequency) : '—');
            var active = (m.status || 'active') === 'active';
            var pill = '<span class="pill ' + (active ? 'pill-info' : 'pill-flag') + '">' +
              (active ? t('Active', 'Ativa') : escapeHtml(m.status)) + '</span>';
            var note = String(m.note || '');
            var firstSentence = note.split('. ')[0];
            var noteCell = note
              ? '<td title="' + escapeHtml(note) + '">' + escapeHtml(firstSentence.replace(/\.$/, '')) + '</td>'
              : '<td>—</td>';
            return '<tr><td class="strong">' + escapeHtml(m.name || '') + '</td>' +
              '<td class="num">' + daily + '</td>' +
              '<td>' + escapeHtml(m.drug_class || '—') + '</td>' +
              '<td>' + pill + '</td>' +
              noteCell + '</tr>';
          }).join('');
        }
        if (suppsBody && supps.length) {
          suppsBody.innerHTML = supps.map(function (sp) {
            return '<tr><td class="strong">' + escapeHtml(sp.name || '') + '</td>' +
              '<td class="num">' + escapeHtml(sp.dose || '—') + '</td><td>—</td></tr>';
          }).join('');
        }
      })
      .catch(function () {
        // Fetch failure -> hide rather than show empty tables (house pattern).
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

  // A study is "validated" only when a clinician signed it (validating_doctor).
  // Studies with no signed report — e.g. an AI reading of a digitized printout —
  // must never be framed as a doctor's validated reading. Keyed on data, not on
  // the patient, so it generalizes to every record.
  function ecgIsValidated(s) { return !!(s && s.validating_doctor); }

  function ecgFriendlyLine(s) {
    if (!ecgIsValidated(s)) {
      return t(
        'An ECG records your heart’s electrical rhythm. There is no signed medical report on file for this tracing — the reading shown is an automated (AI) interpretation of a digitized image, not a diagnosis, and precise measurements could not be taken from it. Please review the original ECG with a cardiologist, who can measure it properly and tell you what it means for you.',
        'O ECG registra o ritmo elétrico do coração. Não há laudo médico assinado em arquivo para este traçado — a leitura exibida é uma interpretação automatizada (IA) de uma imagem digitalizada, não um diagnóstico, e medidas precisas não puderam ser extraídas dela. Leve o ECG original a um(a) cardiologista, que poderá medi-lo corretamente e explicar o que significa para você.');
    }
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

  // Fidelity label, bilingual. The DB stores a canonical English technical
  // string (e.g. "Vector reconstruction…" / "Source image (not vectorized)…");
  // map the known kinds to bilingual patient-facing copy, else show it raw.
  function ecgFidelityHtml(s) {
    var f = s.fidelity || '';
    if (/not vectoriz/i.test(f)) {
      return t('Source image (not vectorized) — a visual rendering of the original tracing, not a diagnostic instrument.',
               'Imagem de origem (não vetorizada) — representação visual do traçado original, não é um instrumento diagnóstico.');
    }
    if (/vector reconstruction/i.test(f)) {
      return t('Vector reconstruction from the source signal — a visual rendering, not a diagnostic instrument.',
               'Reconstrução vetorial a partir do sinal de origem — representação visual, não é um instrumento diagnóstico.');
    }
    return escapeHtml(f);
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
    // Validated studies show the clinician's conclusion as "Conclusion". An
    // unsigned/AI-inferred reading is labelled honestly so it is never mistaken
    // for a doctor's validated finding.
    var conclLabel = ecgIsValidated(s)
      ? t('Conclusion', 'Conclusão')
      : t('AI impression (from image — not validated)', 'Impressão por IA (da imagem — não validada)');
    var conclClass = ecgIsValidated(s) ? 'alert alert-info' : 'alert alert-warn';
    var concl = s.interpretation
      ? ('<div class="' + conclClass + '"><strong>' + conclLabel + ':</strong> ' + escapeHtml(s.interpretation) + '</div>')
      : '';
    return '' +
      '<h2 class="section-title"><span class="lang-en">Electrocardiogram (ECG) · ' + dn.en + '</span>' +
        '<span class="lang-pt">Eletrocardiograma (ECG) · ' + dn.pt + '</span></h2>' +
      (s.clinic || s.ordering_doctor
        ? ('<p class="section-desc">' + [
            s.clinic ? escapeHtml(s.clinic) : '',
            s.ordering_doctor ? ('· ' + t('ordered by', 'solicitado por') + ' ' + escapeHtml(s.ordering_doctor)) : '',
          ].filter(Boolean).join(' ') + '</p>')
        : '') +
      '<div class="ecg-chart" data-ecg-id="' + escapeHtml(String(s.id)) + '" data-clerk="' + escapeHtml(String(clerk)) + '">' +
        '<div class="ecg-chart-loading">' + t('Loading chart…', 'Carregando traçado…') + '</div></div>' +
      (s.fidelity ? ('<p class="ecg-fidelity">' + ecgFidelityHtml(s) + '</p>') : '') +
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
      fetch('/api/patient-ecg-object?clerk=' + encodeURIComponent(ck) + '&id=' + encodeURIComponent(id) + '&kind=svg',
            { headers: { 'X-Viewer-Clerk': viewerClerkHeader() } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (svg) { node.innerHTML = svg; })
        .catch(function () { node.innerHTML = '<div class="ecg-chart-loading">' + t('Chart unavailable', 'Traçado indisponível') + '</div>'; });
    });
  }

  // Fill an ECG section/mount pair from /api/patient-exams (the shared DB-driven
  // path). Defaults to the static shell's global #ecg-section/#ecg-mount
  // (Joao/Leo/John). Bespoke assembler pages (e.g. Paulo) pass a scoped root +
  // selectors so their OWN mount is filled — the static shell's duplicate-id
  // mount survives hidePageBody() hidden-but-present, and must never be targeted.
  function decorateEcgStudies(clerk, opts) {
    opts = opts || {};
    var scope = opts.root || document;
    var section = scope.querySelector(opts.sectionSel || '#ecg-section');
    var mount = scope.querySelector(opts.mountSel || '#ecg-mount');
    if (!section || !mount) return;
    // Send the viewer header (self -> own clerk; admin -> proxied clerk) so the
    // ECG block also renders under admin/proxy-view, consistent with the rest of
    // patient-context.js's fetches — cookie-only auth left non-owning viewers 401.
    fetch('/api/patient-exams?clerk=' + encodeURIComponent(clerk), { headers: { Accept: 'application/json', 'X-Viewer-Clerk': viewerClerkHeader() } })
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

  /* ── Per-patient data assets (dispatcher-injected) ────────────────────
     These PHI data files are gated per patient at the worker (GATED_ASSETS /
     scoped access); they used to be <script>-tagged on every shell, giving
     every non-owning viewer a guaranteed 403/503 on the critical path
     (defect #10). The dispatcher now injects only the active patient's
     file(s) and awaits the load before the providers run. */
  var PATIENT_DATA_ASSETS = {};
  PATIENT_DATA_ASSETS[PAULO_SILOTTO] = [
    'assets/paulo-labs.js?v=5', 'assets/paulo-ergometric.js?v=1',
    'assets/paulo-sleep.js?v=1', 'assets/paulo-mental.js?v=1',
  ];
  PATIENT_DATA_ASSETS[SILVANA_CRESTE] = ['assets/silvana-labs.js?v=3', 'assets/silvana-vitals.js?v=1'];
  PATIENT_DATA_ASSETS[CRISTINA_CRESTI] = ['assets/cristina-labs.js?v=2'];

  function loadPatientDataAssets(clerkId) {
    var srcs = PATIENT_DATA_ASSETS[clerkId] || [];
    return Promise.all(srcs.map(function (srcUrl) {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = srcUrl;
        s.onload = resolve;
        s.onerror = resolve; // providers null-check their globals
        document.head.appendChild(s);
      });
    }));
  }

  /* ── AI provider helpers ── */
  function aiPayloadOf(ctx) {
    var d = ctx.payloads && ctx.payloads.dashboard;
    var rec = d && d.sections && d.sections['ai-insights'];
    var pl = rec && rec.cards_json;
    return (pl && pl.pages) ? pl : null;
  }
  /* Restored: deleted by c8ecaafe (D1 refactor) while three call sites
     remained — every aiBlockEl-wrapped AI block silently failed to render
     platform-wide (ReferenceError swallowed by the provider try/catch). */
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

  function aiBlockEl(html) {
    injectAiInsightsStyles();
    var sec = document.createElement('section');
    sec.className = 'ai-ins-block';
    sec.setAttribute('data-ai-insights', '1');
    sec.innerHTML = html;
    return sec;
  }
  function examsPartsOf(ctx) {
    if (!('examsParts' in ctx.shared)) {
      ctx.shared.examsParts = ctx.payloads.exams ? buildExamsParts(ctx.payloads.exams) : null;
    }
    return ctx.shared.examsParts;
  }
  function examsAfterOnce(ctx, parts) {
    return function (root) {
      if (ctx.shared.examsAfterRan) return;
      ctx.shared.examsAfterRan = true;
      parts.after(root);
      decorateExamsWithAiOutliers(); // dashboard-driven per-marker notes
    };
  }

  /* ── Section providers (consumed by page-assembler.js via the registry).
     Every function returns an Element, an HTML string, {el, after}, or null.
     Registered before dispatch; the assembler looks them up by name. ── */
  function registerLumenProviders() {
    window.LUMEN_PROVIDERS = {

      /* slot-2 concise AI summary (gate G-DASH / G-DOMAIN via registry) */
      aiSummary: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var html = aiConciseHtml(pl, ctx.page);
        return html ? aiBlockEl(html) : null;
      },
      homeActivePriorities: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var sm = pl.summary || {};
        var work = aiResolveRefs(pl, sm.points_to_work_on || sm.top_attention_points).map(aiInsightCard).join('');
        if (!work) return null;
        return aiBlockEl(aiHeader('Active clinical priorities', 'Prioridades clínicas ativas') + work);
      },
      homeHealthSynthesis: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var sm = pl.summary || {};
        var lev = aiResolveRefs(pl, sm.points_to_leverage || sm.top_strengths).map(aiInsightCard).join('');
        var links = (sm.cross_domain_links || []).map(aiCrossCard).join('');
        if (!lev && !links) return null;
        return aiBlockEl(aiHeader('Health synthesis', 'Síntese de saúde')
          + (lev ? '<h3 class="ai-sub">' + t('Points to leverage', 'Pontos a favor') + '</h3>' + lev : '')
          + (links ? '<h3 class="ai-sub">' + t('Cross-domain links', 'Conexões entre domínios') + '</h3>' + links : ''));
      },
      aiAttentionStrengths: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var domain = PAGE_TO_DOMAIN[ctx.page];
        var page = domain && pl.pages && pl.pages[domain];
        if (!page) return null;
        var cards = aiPillarCards(page);
        if (!cards) return null;
        var lbl = { physical: ['Physical', 'Físico'], mental: ['Mental', 'Mental'], spiritual: ['Spiritual', 'Espiritual'] }[domain];
        return aiBlockEl(aiHeader(lbl[0] + ' — AI synthesis', lbl[1] + ' — síntese por IA') + cards);
      },
      aiFromYourRecord: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var w = sortCardsByRank(pl.inline_insights).filter(function (x) {
          return x.subpage === 'writings' || x.subpage === 'mental';
        }).map(aiInlineCard).join('');
        if (!w) return null;
        return aiBlockEl(aiHeader('From your record', 'Do seu prontuário') + w);
      },
      aiSpecificFindings: function (ctx) {
        var pl = aiPayloadOf(ctx);
        if (!pl) return null;
        var SUBS = {
          'physical-exams': ['labs', 'imaging', 'physical-exams'],
          'physical-vitals': ['vitals', 'ecg', 'physical-vitals'],
          'physical-genetics': ['pgx', 'physical-genetics'],
          'spiritual': ['journal', 'spiritual'],
          /* consult is the whole-record scroll page: union of every anchor */
          'consult': ['labs', 'imaging', 'physical-exams', 'vitals', 'ecg',
                      'physical-vitals', 'pgx', 'physical-genetics', 'journal', 'spiritual'],
        };
        var subs = SUBS[ctx.page];
        if (!subs) return null;
        var inl = sortCardsByRank(pl.inline_insights).filter(function (x) { return subs.indexOf(x.subpage) >= 0; }).map(aiInlineCard).join('');
        if (!inl) return null;
        return aiBlockEl(aiHeader('Specific findings', 'Achados específicos') + inl);
      },

      /* home */
      homeReportsNav: function (ctx) { return homeReportsNavHtml(ctx.payloads.summary || {}); },
      homeAtAGlance: function (ctx) { return homeAtAGlanceHtml(ctx.payloads.summary || {}); },
      homeInjuries: function (ctx) { return homeInjuriesHtml(ctx.payloads.summary || {}); },
      homeConnectedSources: function () { return null; }, // D6: no DB-backed source list yet
      homeMedications: function (ctx) { return medsSectionHome(ctx.payloads.summary || {}); },
      pauloPainMap: function () { return buildPauloPainMapSection(); },

      /* physical hub */
      physBrowseCards: function (ctx) { return physBrowseCardsHtml(ctx.payloads.summary || {}); },
      physClinicalHistory: function () { return null; }, // no queryable encounters array yet (D6)
      physMedications: function (ctx) { return medsSectionInline(ctx.payloads.summary || {}); },
      silvanaLanding: function () { return renderSilvanaPhysicalLanding(); },

      /* physical-vitals */
      vitalsSection: function (ctx) {
        var d = ctx.payloads.vitals;
        if (!d) return null;
        var sh = ctx.shared;
        if (!('vitalsParts' in sh)) sh.vitalsParts = computeVitalsParts(ctx.payloads.summary || {}, d);
        var vp = sh.vitalsParts;
        if (!vp) return null;
        var html = vp.parts[ctx.entry.id];
        if (!html) return null;
        var pre = '';
        if (!sh.vitalsChromeDone) {
          sh.vitalsChromeDone = true;
          pre = vp.topMetricsHtml + vp.navHtml; // metric tiles + in-page nav, once
        }
        var el = document.createElement('div');
        el.innerHTML = pre + html;
        return {
          el: el,
          after: function () {
            if (sh.vitalsChartsRan) return;
            sh.vitalsChartsRan = true;
            runVitalsBuilders(); // canvases are in the DOM now
          },
        };
      },
      silvanaVitals: function () { return renderSilvanaVitals(); },

      /* Body composition · bioimpedance (orders 21-25). Each returns null when
         the device didn't produce that data, so the assembler omits the
         section rather than drawing an empty one. */
      biaCards: function (ctx) { return renderBiaCards(ctx); },
      biaMuscleFat: function (ctx) { return renderBiaMuscleFat(ctx); },
      biaObesity: function (ctx) { return renderBiaObesity(ctx); },
      biaSegmental: function (ctx) { return renderBiaSegmental(ctx); },
      biaHistory: function (ctx) { return renderBiaHistory(ctx); },

      /* physical-exams */
      examsImaging: function (ctx) {
        var parts = examsPartsOf(ctx);
        if (!parts || !parts.imagingHtml) return null;
        var el = document.createElement('div');
        el.className = 'jc-exams';
        el.innerHTML = parts.imagingHtml;
        return { el: el, after: examsAfterOnce(ctx, parts) };
      },
      examsLaboratory: function (ctx) {
        var parts = examsPartsOf(ctx);
        if (!parts || !parts.laboratoryHtml) return null;
        var el = document.createElement('div');
        el.className = 'jc-exams';
        el.innerHTML = parts.laboratoryHtml;
        return { el: el, after: examsAfterOnce(ctx, parts) };
      },
      examsMicrobiota: function () { return null; }, // no payload array yet (D6)
      examsAudit: function () { return null; },      // no payload array yet (D6)
      pauloExams: function () { return renderPauloPhysicalExams(); },
      silvanaExams: function () {
        var el = renderSilvanaPhysicalExams();
        if (!el) return null;
        return { el: el, after: function () { setTimeout(decorateExamsWithAiOutliers, 600); } };
      },
      cristinaExams: function () {
        var el = renderCristinaPhysicalExams();
        if (!el) return null;
        return { el: el, after: function () { setTimeout(decorateExamsWithAiOutliers, 600); } };
      },

      /* physical-genetics — DB-driven PGx arrives with build prompt #3 (D6) */
      pgxSummary: function () { return null; },
      pgxMedsTable: function () { return null; },
      pgxModules: function () { return null; },

      /* mental */
      psychArchitecture: function (ctx) {
        return ctx.payloads.psych ? psychArchitectureHtml(ctx.payloads.psych) : null;
      },
      psychLifeHistory: function (ctx) {
        return ctx.payloads.psych ? psychLifeHistoryHtml(ctx.payloads.psych) : null;
      },
      pauloMental: function () { return renderPauloMental(); },

      /* spiritual — topic arrays have no queryable payload yet (D6) */
      spiritualTopic: function () { return null; },
    };
  }

  /* One /api/patient-dashboard fetch per page view, shared by the banner and
     both AI decorators (it is the largest API response on the page).
     jcRefreshAiInsights busts the memo so a rebuild re-reads fresh data. */
  var dashboardJsonPromise = null;
  function fetchDashboardJson(fresh) {
    if (fresh) dashboardJsonPromise = null;
    if (!dashboardJsonPromise) {
      dashboardJsonPromise = fetch('/api/patient-dashboard?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return dashboardJsonPromise;
  }

  /* Unified page banner on the static-bespoke shells (prompt #2b): swap the
     hardcoded hero for the shared component — identity strictly from
     /api/patient-summary, "Prepared" from the newest dashboard generated_at
     (I-3). No swap without live identity (the inert static hero stays).
     The vitals range selector is moved into the new banner; the old heroes'
     back-links retire with them by design — the banner has none, matching
     the assembler pages, and pillar navigation lives in the top nav. */
  function decorateStaticBanner(section) {
    var A = window.LUMEN_ASSEMBLER;
    if (!A || !A.renderPageBanner) return;
    var meta = (window.LUMEN_PAGE_META || {})[section];
    if (!meta) return;
    function getJson(url) {
      return fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    Promise.all([getJson('/api/patient-summary?clerk=' + encodeURIComponent(patient)), fetchDashboardJson()])
      .then(function (res) {
        var summary = res[0];
        if (!summary || !summary.patient || !summary.patient.full_name) return;
        var hero = document.querySelector('.hero, .page-header, .sp-hero');
        if (!hero || !hero.parentNode) return;
        var generatedAt = A.newestGeneratedAt ? A.newestGeneratedAt({ dashboard: res[1] }) : null;
        var wrap = document.createElement('div');
        wrap.innerHTML = A.renderPageBanner(summary, meta, generatedAt);
        var banner = wrap.firstElementChild;
        if (!banner) return;
        var inner = banner.querySelector('.banner-inner') || banner;
        hero.querySelectorAll('.vr-bar').forEach(function (n) { inner.appendChild(n); });
        hero.parentNode.replaceChild(banner, hero);
        /* tab title localizes with real identity, like the assembler (I-7) */
        document.title = 'Lumen Health — ' +
          (meta.title ? A.tPlain(meta.title.en, meta.title.pt) : section) +
          ' · ' + summary.patient.full_name;
      });
  }

  /* Assembler tail on the static-bespoke shells: Upload → Update-AI-Insights
     (→ Delete on home only, D3), inserted before the shell footer. */
  function injectStaticTail(section) {
    if (!window.LUMEN_ASSEMBLER) return;
    if (document.querySelector('.lumen-tail')) return;
    var tail = window.LUMEN_ASSEMBLER.buildTail(patient, section);
    if (!tail) return;
    var footer = document.querySelector('footer.doc-footer') || document.querySelector('footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(tail, footer);
    else document.body.appendChild(tail);
  }

  /* ── Dispatch ─────────────────────────────────────────────────────────
     Two paths only (I-2): the static-bespoke trio renders from the
     hardcoded shells + decorators; every other patient goes through
     assemblePage(), with per-patient variation expressed ONLY as registry
     data (patientScope entries). The old >=12-branch patient ladder is
     retired. */
  var STATIC_BESPOKE = [PATIENT_ZERO, LEO_KELLER, JOHN_SMITH_JR];

  ready(function () {
    injectChangeButton();
    injectViewToggle();
    registerLumenProviders();

    /* The consultation scroll page has no static shell content to decorate —
       every patient (including the static-bespoke trio, whose DB record is a
       mirror of their static pages) renders it through the assembler. */
    if (STATIC_BESPOKE.indexOf(patient) !== -1 && currentSection() !== 'consult') {
      var section0 = currentSection();
      if (section0 === 'home') {
        injectStyles();
        decorateProceduresFromDb(patient); // fill #injury tables from the DB
      } else if (section0 === 'physical') {
        injectStyles();
        decorateMedsFromDb(patient); // fill the #meds pharmacology tables from the DB
      } else if (section0 === 'physical-exams') {
        injectStyles();
        retrofitStaticLabHistory();
        decorateExamsWithAiOutliers(); // 9a — AI outlier explanation onto static lab cards
        decorateEcgStudies(patient);   // DB-driven ECG block on the static page
      }
      // Contract order on the static shells: tail first (so the AI topic
      // block can anchor before it), then the split AI decorator places the
      // concise summary right after the hero and the topic block before the
      // tail. The legend line lands under the first AI-badged block.
      decorateStaticBanner(section0);
      injectStaticTail(section0);
      decorateWithAiInsights(section0);
      if (window.LUMEN_ASSEMBLER) window.LUMEN_ASSEMBLER.ensureAiLegend();
      return;
    }

    injectStyles();
    hidePageBody();
    // The static shells' fixed side rail is hidden by hidePageBody, but the
    // body class would keep shifting the assembler root 240px right into a
    // phantom gutter — drop it so the page (and banner) span the viewport.
    document.body.classList.remove('has-side-nav');
    gatePillarNav(patient); // canon: hide nav entries for pillars with no data

    var section = currentSection();
    loadPatientDataAssets(patient).then(function () {
      if (!window.LUMEN_ASSEMBLER || !window.LUMEN_REGISTRY) {
        console.error('[lumen] page assembler / section registry not loaded');
        return;
      }
      window.LUMEN_ASSEMBLER.assemble(patient, section);
    });
  });


  function viewerClerkHeader() {
    var vc = sessionStorage.getItem('jc_viewer_clerk') || sessionStorage.getItem('jc_current_patient') || patient;
    return vc;
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
    function refLine(v) {
      var y = yPx(v);
      return '<line x1="' + padL + '" x2="' + (padL + iw) + '" y1="' + y + '" y2="' + y + '" stroke="#ABBFE5" stroke-dasharray="3,3" stroke-width="1"/>';
    }
    if (yLow != null && yHigh != null && isFinite(yLow) && isFinite(yHigh)) {
      var y1 = yPx(yHigh), y2 = yPx(yLow);
      refBand =
        '<rect x="' + padL + '" y="' + y1 + '" width="' + iw + '" height="' + (y2 - y1) +
        '" fill="#E7EEFB" opacity="0.6"/>' + refLine(yHigh) + refLine(yLow);
    } else if (yLow != null && isFinite(yLow)) {
      refBand = refLine(yLow);   // one-sided range ("> low"): single dashed floor
    } else if (yHigh != null && isFinite(yHigh)) {
      refBand = refLine(yHigh);  // one-sided range ("< high"): single dashed ceiling
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
  /* ── Deterministic card order (D1) — MIRROR of lib/card-order.js ──────
     That module is the source of truth (write path + backfill); this classic
     IIFE cannot import ESM, so the comparator is mirrored here for the
     defensive read-side sort. Change BOTH together. */
  var CARD_SUBPAGE_ORD = {
    'home': 0, 'physical': 1, 'physical-vitals': 2, 'physical-exams': 3,
    'physical-genetics': 4, 'mental': 5, 'spiritual': 6,
  };
  var CARD_PREFIX_ORD = { lab: 0, imaging: 1, ecg: 2, vitals: 3, pgx: 4, interaction: 5, journal: 6 };
  var CARD_RISK_ORD = { high: 0, medium: 1, low: 2 };
  function cardSortKey(card) {
    var c = (card && typeof card === 'object') ? card : {};
    var subpage = typeof c.subpage === 'string' ? c.subpage : '';
    var anchor = typeof c.anchor === 'string' ? c.anchor : '';
    var prefix = anchor.indexOf(':') >= 0 ? anchor.slice(0, anchor.indexOf(':')) : '';
    var sub = (subpage in CARD_SUBPAGE_ORD) ? CARD_SUBPAGE_ORD[subpage] : 99;
    var pre = (prefix in CARD_PREFIX_ORD) ? CARD_PREFIX_ORD[prefix] : 99;
    var riskKey = typeof c.risk_level === 'string' ? c.risk_level : '';
    var risk = (riskKey in CARD_RISK_ORD) ? CARD_RISK_ORD[riskKey] : 3;
    return [sub, pre, pre === 99 ? prefix : '', risk, anchor];
  }
  function compareCards(a, b) {
    var ka = cardSortKey(a), kb = cardSortKey(b);
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  }
  /* Sort by persisted rank; fall back to the key when any card lacks one
     (pre-backfill payloads still render deterministically ordered). */
  function sortCardsByRank(cards) {
    var arr = (cards || []).slice();
    var allRanked = arr.length > 0 && arr.every(function (c) { return c && typeof c.rank === 'number'; });
    arr.sort(allRanked ? function (a, b) { return a.rank - b.rank; } : compareCards);
    return arr;
  }

  function aiInlineCard(x) {
    if (!x || !x.title) return '';
    var isLab = x.trigger === 'out_of_range_lab' || x.trigger === 'trending_lab';
    var has = function (b) { return b && (b.en || b.pt); };
    // Canonical channel only (contract section 3): `interpretation` carries the
    // card text for every trigger — the deprecated body /
    // plain_language_reading / what_the_report_says fields are never read.
    var body = '';
    if (has(x.interpretation)) body += '<p class="ai-card-summary">' + aiBt(x.interpretation) + '</p>';
    if (isLab) {
      var cf = (x.contributing_factors || []).filter(Boolean).map(function (f) { return '<li>' + aiBt(f) + '</li>'; }).join('');
      if (cf) body += aiInlineSub('Possible contributing factors', 'Possíveis fatores contribuintes', '<ul class="ai-inline-list">' + cf + '</ul>');
    }
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

  var PAGE_TO_DOMAIN = {
    'physical': 'physical', 'physical-vitals': 'physical',
    'physical-exams': 'physical', 'physical-genetics': 'physical',
    'mental': 'mental', 'spiritual': 'spiritual',
  };

  /* Slot-2 concise AI summary (contract template step 2). Home gates on
     G-DASH (payload exists); pillar pages gate on G-DOMAIN — the domain's
     data_sufficient must be true, blocking fabricated synthesis on empty
     domains. Returns '' when the gate fails.                              */
  function aiConciseHtml(p, section) {
    var sm = p.summary || {};
    /* consult (whole-record scroll page) gets the home register: the
       cross-domain headline + overview, not a single domain's synthesis. */
    if (section === 'home' || section === 'consult') {
      var headline = sm.headline ? aiBt(sm.headline) : '';
      var overview = aiOverview(sm.overview);
      if (!headline && !overview) return '';
      return aiHeader('AI summary', 'Resumo por IA', headline) + overview;
    }
    var domain = PAGE_TO_DOMAIN[section];
    var page = domain && p.pages && p.pages[domain];
    if (!page || page.data_sufficient !== true) return '';
    /* Depth ladder: subpages prefer their own deeper page_overviews entry
       (prompt #2c follow-up); pillar overview is the fallback for payloads
       built before page_overviews existed. */
    var po = p.page_overviews && p.page_overviews[section];
    var ov = aiOverview(po) || aiOverview(page.overview);
    if (!ov) return '';
    return aiHeader('AI summary', 'Resumo por IA') + ov;
  }

  /* Topic-position AI block: home → Health synthesis (points to work on /
     leverage / cross-domain links); pillar pages → attention/strengths (+
     mental writings); exam/vitals/genetics pages → Specific findings.     */
  function aiTopicHtml(p, section) {
    var pages = p.pages || {};
    var sm = p.summary || {};
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
      if (!work && !lev && !links) return '';
      return aiHeader('Health synthesis', 'Síntese de saúde')
        + (work ? '<h3 class="ai-sub">' + t('Points to work on', 'Pontos a trabalhar') + '</h3>' + work : '')
        + (lev ? '<h3 class="ai-sub">' + t('Points to leverage', 'Pontos a favor') + '</h3>' + lev : '')
        + (links ? '<h3 class="ai-sub">' + t('Cross-domain links', 'Conexões entre domínios') + '</h3>' + links : '');
    }
    if (section === 'physical' || section === 'mental' || section === 'spiritual') {
      var cards = aiPillarCards(pages[section]);
      var extra = '';
      if (section === 'mental') {
        var w = sortCardsByRank(p.inline_insights).filter(function (x) {
          return x.subpage === 'writings' || x.subpage === 'mental';
        }).map(aiInlineCard).join('');
        if (w) extra = '<h3 class="ai-sub">' + t('From your record', 'A partir do seu prontuário') + '</h3>' + w;
      }
      if (!cards && !extra) return '';
      var lbl = { physical: ['Physical', 'Físico'], mental: ['Mental', 'Mental'], spiritual: ['Spiritual', 'Espiritual'] }[section];
      return aiHeader(lbl[0] + ' — AI synthesis', lbl[1] + ' — síntese por IA') + cards + extra;
    }
    if (INLINE_FOR[section]) {
      var subs = INLINE_FOR[section];
      var inl = sortCardsByRank(p.inline_insights).filter(function (x) { return subs.indexOf(x.subpage) >= 0; }).map(aiInlineCard).join('');
      if (!inl) return '';
      return aiHeader('Specific findings', 'Achados específicos') + inl;
    }
    return '';
  }

  /* Static-bespoke pages (Patient Zero / Leo / John): fetch the ai-insights
     payload once and place the two blocks per the contract — the concise
     summary immediately AFTER the hero, the topic block just before the
     assembler tail (else before the footer). No bottom-dock, no self-pin. */
  function decorateWithAiInsights(section) {
    fetchDashboardJson()
      .then(function (data) {
        data = data || { sections: {} };
        var rec = data && data.sections && data.sections['ai-insights'];
        var payload = rec && rec.cards_json;
        if (!payload || !payload.pages) return;
        injectAiInsightsStyles();
        document.querySelectorAll('section[data-ai-insights]').forEach(function (n) { n.remove(); });

        var concise = aiConciseHtml(payload, section);
        if (concise) {
          var sec1 = document.createElement('section');
          sec1.className = 'ai-ins-block ai-ins-concise';
          sec1.setAttribute('data-ai-insights', '1');
          sec1.innerHTML = concise;
          var hero = document.querySelector('.page-banner, .hero, .page-header, .sp-hero');
          if (hero && hero.parentNode) hero.parentNode.insertBefore(sec1, hero.nextSibling);
          else document.body.insertBefore(sec1, document.body.firstChild);
        }

        var topic = aiTopicHtml(payload, section);
        if (topic) {
          var sec2 = document.createElement('section');
          sec2.className = 'ai-ins-block';
          sec2.setAttribute('data-ai-insights', '1');
          sec2.innerHTML = topic;
          var tail = document.querySelector('.lumen-tail');
          var footer = document.querySelector('footer');
          if (tail && tail.parentNode) tail.parentNode.insertBefore(sec2, tail);
          else if (footer && footer.parentNode) footer.parentNode.insertBefore(sec2, footer);
          else document.body.appendChild(sec2);
        }

        if (window.LUMEN_ASSEMBLER) window.LUMEN_ASSEMBLER.ensureAiLegend();
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
    fetchDashboardJson()
      .then(function (data) {
        data = data || { sections: {} };
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
          // Bilingual cards (Silvana/Paulo reuse silvanaMarkerCard) put BOTH
          // .lang-en and .lang-pt spans inside .lab-test-name, so textContent
          // concatenates EN+PT ("Total cholesterolColesterol total") and never
          // matches the model's single-language analyte key. Prefer the English
          // span (the language the model emits analyte names in) when present;
          // fall back to full textContent for plain single-language markup.
          var enSpan = nameEl.querySelector('.lang-en');
          var nameText = enSpan ? enSpan.textContent : nameEl.textContent;
          var x = byKey[normAnalyte(nameText)];
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
      if (document.querySelector('.lumen-page-root')) { location.reload(); return; }
      fetchDashboardJson(true); // bust the shared memo: the rebuild just changed the payload
      decorateWithAiInsights(sec || currentSection());
      if ((sec || currentSection()) === 'physical-exams') decorateExamsWithAiOutliers();
    } catch (e) { /* keep existing cards */ }
  };

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
      labelEn: '5A · MRI · Cervical spine',
      labelPt: '5A · RM · Coluna cervical',
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
      labelEn: '5B · MRI · Lumbar spine',
      labelPt: '5B · RM · Coluna lombar',
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
      '.jc-paulo-exams { background: var(--surface-base, #F9F7F4); padding: 0 0 96px; }',
      '.jc-paulo-exams .hero { background: #0D1B2A; color: #FFFFFF; padding: 48px 0 56px; }',
      '.jc-paulo-exams .hero .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-exams .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 10px; }',
      '.jc-paulo-exams .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; line-height: 1.15; color: #FFFFFF; margin: 0 0 12px; }',
      '.jc-paulo-exams .hero-sub { color: rgba(255,255,255,0.78); font-size: 15px; line-height: 1.6; margin: 0 0 18px; max-width: 70ch; }',
      '.jc-paulo-exams .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; margin-top: 8px; }',
      '.jc-paulo-exams .hero-meta-item { display: flex; flex-direction: column; gap: 2px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.06em; text-transform: uppercase; }',
      '.jc-paulo-exams .hero-meta-item > span:last-child { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 400; color: #FFFFFF; text-transform: none; letter-spacing: 0; }',
      '.jc-paulo-exams #imagery { padding: 48px 0 24px; }',
      '.jc-paulo-exams #imagery > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-exams #imagery .imagery-exam > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      // View-tab strip inside the .ct-viewer head
      '.jc-paulo-exams .ct-viewer-head { flex-wrap: wrap; gap: 10px; }',
      '.jc-paulo-exams .pl-view-tabs { display: inline-flex; gap: 4px; background: rgba(13, 27, 42, 0.06); border: 1px solid var(--border-subtle, #E5E2DC); border-radius: 6px; padding: 3px; }',
      '.jc-paulo-exams .pl-view-tab { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #1E2D3D; background: transparent; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; transition: background 0.12s, color 0.12s; }',
      '.jc-paulo-exams .pl-view-tab:hover { background: rgba(13, 27, 42, 0.06); }',
      '.jc-paulo-exams .pl-view-tab[aria-pressed="true"] { background: #244E6E; color: #FFFFFF; }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tabs { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab { color: rgba(255,255,255,0.85); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab:hover { background: rgba(255,255,255,0.08); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-view-tab[aria-pressed="true"] { background: #FFFFFF; color: #0D1B2A; }',
      // Unified-viewer toggle bar (region + plane)
      '.jc-paulo-exams .pl-toggle-bar { display: flex; flex-wrap: wrap; gap: 18px; padding: 10px 14px; background: var(--blue-50, #EBF2F8); border-bottom: 1px solid var(--border-subtle, #E5E2DC); }',
      '.jc-paulo-exams .pl-tab-group { display: flex; align-items: center; gap: 8px; }',
      '.jc-paulo-exams .pl-tab-group-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--blue-700, #244E6E); font-weight: 500; }',
      '.jc-paulo-exams .pl-tabs { display: inline-flex; gap: 2px; background: #FFFFFF; border: 1px solid var(--border-subtle, #E5E2DC); border-radius: 6px; padding: 2px; }',
      '.jc-paulo-exams .pl-tab { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #1E2D3D; background: transparent; border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; transition: background 0.12s, color 0.12s; }',
      '.jc-paulo-exams .pl-tab:hover { background: rgba(13, 27, 42, 0.06); }',
      '.jc-paulo-exams .pl-tab[aria-pressed="true"] { background: #244E6E; color: #FFFFFF; }',
      '.jc-paulo-exams .pl-sequence-tag { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; padding: 2px 8px; background: rgba(13, 27, 42, 0.08); border-radius: 999px; color: #244E6E; margin-right: 10px; vertical-align: 1px; }',
      '.jc-paulo-exams .pl-sequence-tag:empty { display: none; }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-toggle-bar { background: rgba(0,0,0,0.55); border-bottom-color: rgba(255,255,255,0.12); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab-group-label { color: rgba(255,255,255,0.78); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tabs { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab { color: rgba(255,255,255,0.85); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab:hover { background: rgba(255,255,255,0.08); }',
      '.jc-paulo-exams .ct-viewer.is-fullscreen .pl-tab[aria-pressed="true"] { background: #FFFFFF; color: #0D1B2A; }',

      // Side-by-side reports
      '.jc-paulo-exams .paulo-reports-heading { font-family: "Raleway", sans-serif; font-size: 20px; font-weight: 700; color: var(--blue-800, #0D1B2A); margin: 2.5rem 0 0.75rem; }',
      '.jc-paulo-exams .paulo-reports-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }',
      '@media (max-width: 960px) { .jc-paulo-exams .paulo-reports-grid { grid-template-columns: 1fr; } }',
      '.jc-paulo-exams .paulo-report-col { display: flex; flex-direction: column; gap: 12px; }',
      '.jc-paulo-exams .paulo-report-col-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 0 0 6px; border-bottom: 1px solid var(--border-subtle, #E5E2DC); }',
      '.jc-paulo-exams .paulo-report-col-title { font-family: "Raleway", sans-serif; font-size: 15px; font-weight: 700; color: var(--blue-800, #0D1B2A); margin: 0; }',
      '.jc-paulo-exams .paulo-report-col-pdf { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 3px 8px; border-radius: 6px; }',
      '.jc-paulo-exams .paulo-report-col-pdf:hover { background: #FFF6E5; }',
      // Override the global .ct-grid-single cap (620px) so the viewer fills the page.
      '.jc-paulo-exams .ct-grid.ct-grid-single { max-width: none; margin-left: 0; margin-right: 0; }',
      '.jc-paulo-exams .ct-stage { aspect-ratio: 16 / 9; max-height: 720px; }',
      // AI summary card slot above the exam blocks
      '.jc-paulo-exams .paulo-ai-summary-wrap { padding: 0 0 8px; }',
      '.jc-paulo-exams .paulo-ai-summary-wrap .container { max-width: 1080px; margin: 0 auto; padding: 24px 24px 0; }',
      '.jc-paulo-exams .paulo-ai-summary { background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #B8954A; border-radius: 10px; padding: 22px 26px; }',
      '.jc-paulo-exams .paulo-ai-summary-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }',
      '.jc-paulo-exams .paulo-ai-summary-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0; }',
      '.jc-paulo-exams .paulo-ai-summary-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 14px; }',
      // Sub-heading row inside the synthesis card ("Current snapshot", "Longitudinal evolution")
      '.jc-paulo-exams .paulo-ai-subhead { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; margin: 8px 0 10px; }',
      // Evolution-arc block (cervical + lumbar arc cards inside the AI synthesis card)
      '.jc-paulo-exams .paulo-ai-arcs-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      '.jc-paulo-exams .paulo-ai-arcs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }',
      '@media (max-width: 820px) { .jc-paulo-exams .paulo-ai-arcs { grid-template-columns: 1fr; } }',
      '.jc-paulo-exams .paulo-ai-arc { background: #F9F7F4; border: 1px solid #E5E2DC; border-left: 3px solid #B8954A; border-radius: 8px; padding: 14px 16px; }',
      '.jc-paulo-exams .paulo-ai-arc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #E5E2DC; }',
      '.jc-paulo-exams .paulo-ai-arc-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 14px; color: #0D1B2A; margin: 0; }',
      '.jc-paulo-exams .paulo-ai-arc-span { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; }',
      '.jc-paulo-exams .paulo-ai-arc-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.65; color: #1E2D3D; margin: 0; }',
      '.jc-paulo-exams .paulo-ai-arc-body strong { color: #0D1B2A; }',
      '.jc-paulo-exams .paulo-ai-arcs-cross { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.65; color: #1E2D3D; margin: 14px 0 0; padding-top: 12px; border-top: 1px dashed #E5E2DC; }',
      '.jc-paulo-exams .paulo-ai-arcs-cross strong { color: #0D1B2A; }',
      '.jc-paulo-exams .paulo-ai-summary-body { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; line-height: 1.65; color: #1E2D3D; }',
      '.jc-paulo-exams .paulo-ai-summary-body p { margin: 0 0 10px; }',
      '.jc-paulo-exams .paulo-ai-summary-body p:last-child { margin-bottom: 0; }',
      '.jc-paulo-exams .paulo-ai-summary-body strong { color: #0D1B2A; }',
      // Three holistic insights — Physical / Mental / Spiritual
      '.jc-paulo-exams .paulo-ai-insights-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      '.jc-paulo-exams .paulo-ai-insights-head { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 12px; }',
      '.jc-paulo-exams .paulo-ai-insights { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      '.jc-paulo-exams .paulo-ai-insight { background: #F9F7F4; border: 1px solid #E5E2DC; border-radius: 8px; padding: 14px 16px; }',
      '.jc-paulo-exams .paulo-ai-insight-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; margin-bottom: 8px; }',
      '.jc-paulo-exams .paulo-ai-insight-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      '.jc-paulo-exams .paulo-ai-insight-body strong { color: #0D1B2A; }',
      '.jc-paulo-exams .paulo-ai-insight.is-tbd { background: #FFFFFF; border-style: dashed; }',
      '.jc-paulo-exams .paulo-ai-insight.is-tbd .paulo-ai-insight-label { color: #7A8FA6; }',
      '.jc-paulo-exams .paulo-ai-insight.is-tbd .paulo-ai-insight-body { color: #7A8FA6; font-style: italic; }',
      '@media (max-width: 820px) { .jc-paulo-exams .paulo-ai-insights { grid-template-columns: 1fr; } }',

      // ── History section (cervical + lumbar timelines) ─────────────
      '.jc-paulo-exams #paulo-history { padding: 16px 0 40px; }',
      '.jc-paulo-exams #paulo-history > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-exams .ph-timeline-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 18px; }',
      '@media (max-width: 960px) { .jc-paulo-exams .ph-timeline-grid { grid-template-columns: 1fr; } }',
      '.jc-paulo-exams .ph-timeline { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 22px 24px; }',
      '.jc-paulo-exams .ph-timeline-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 14px; margin-bottom: 18px; border-bottom: 1px solid #E5E2DC; }',
      '.jc-paulo-exams .ph-timeline-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 18px; color: #0D1B2A; margin: 0; }',
      '.jc-paulo-exams .ph-timeline-span { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; color: #7A8FA6; }',
      '.jc-paulo-exams .ph-entry { position: relative; padding: 0 0 20px 22px; border-left: 1px solid #E5E2DC; }',
      '.jc-paulo-exams .ph-entry:last-child { padding-bottom: 0; }',
      '.jc-paulo-exams .ph-entry::before { content: ""; position: absolute; left: -5px; top: 5px; width: 9px; height: 9px; background: #B8954A; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 0 0 1px #B8954A; }',
      '.jc-paulo-exams .ph-entry-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      '.jc-paulo-exams .ph-entry-meta { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; color: #7A8FA6; margin: 2px 0 8px; }',
      '.jc-paulo-exams .ph-entry-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0 0 10px; }',
      '.jc-paulo-exams .ph-entry-body strong { color: #0D1B2A; }',
      // Per-entry AI evolution callout (between meta and body)
      '.jc-paulo-exams .ph-evolution { background: #FFFBF1; border: 1px solid #EAD9A8; border-left: 3px solid #B8954A; border-radius: 8px; padding: 12px 14px; margin: 8px 0 12px; }',
      '.jc-paulo-exams .ph-evolution-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
      '.jc-paulo-exams .ph-evolution-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7C5B15; font-weight: 700; }',
      '.jc-paulo-exams .ph-evolution-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      '.jc-paulo-exams .ph-evolution-body strong { color: #0D1B2A; }',
      '.jc-paulo-exams .ph-evolution-body em { color: #7C5B15; font-style: italic; }',
      // Section title with inline AI pill
      '.jc-paulo-exams .ph-section-title { display: inline-flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }',
      '.jc-paulo-exams .ph-section-title .ai-pill { font-size: 10px; }',
      '.jc-paulo-exams .ph-entry-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }',
      '.jc-paulo-exams .ph-badge { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }',
      '.jc-paulo-exams .ph-badge-stable { background: #E8F2E8; color: #2E5A2E; }',
      '.jc-paulo-exams .ph-badge-progress { background: #FFF1D6; color: #7C5B15; }',
      '.jc-paulo-exams .ph-badge-flag { background: #F7E1E1; color: #7E2929; }',
      '.jc-paulo-exams .ph-badge-baseline { background: rgba(13, 27, 42, 0.06); color: #244E6E; }',
      '.jc-paulo-exams .ph-entry-pdf { display: inline-flex; align-items: center; gap: 4px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 3px 9px; border-radius: 6px; margin-left: 6px; }',
      '.jc-paulo-exams .ph-entry-pdf:hover { background: #FFF6E5; }',
      '.jc-paulo-exams .ph-takeaway { margin-top: 16px; padding-top: 14px; border-top: 1px dashed #E5E2DC; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      '.jc-paulo-exams .ph-takeaway strong { color: #0D1B2A; }',
      '.jc-paulo-exams .ph-takeaway::before { content: "11-year arc · "; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 700; }',
      '.jc-paulo-exams .ph-takeaway.is-lumbar::before { content: "3-year arc · "; }',

      // ── Other studies section ─────────────────────────────────────
      '.jc-paulo-exams #paulo-other-studies { padding: 16px 0 48px; }',
      '.jc-paulo-exams #paulo-other-studies > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-exams .po-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 18px; }',
      '@media (max-width: 820px) { .jc-paulo-exams .po-grid { grid-template-columns: 1fr; } }',
      '.jc-paulo-exams .po-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }',
      '.jc-paulo-exams .po-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }',
      '.jc-paulo-exams .po-card-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      '.jc-paulo-exams .po-card-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 2px 0 0; line-height: 1.25; }',
      '.jc-paulo-exams .po-card-meta { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; color: #7A8FA6; margin: 4px 0 0; }',
      '.jc-paulo-exams .po-card-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; font-weight: 600; white-space: nowrap; }',
      '.jc-paulo-exams .po-findings { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 0; padding-left: 18px; }',
      '.jc-paulo-exams .po-findings li { margin-bottom: 6px; }',
      '.jc-paulo-exams .po-findings li:last-child { margin-bottom: 0; }',
      '.jc-paulo-exams .po-findings strong { color: #0D1B2A; }',
      '.jc-paulo-exams .po-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px dashed #E5E2DC; }',
      '.jc-paulo-exams .po-pending { display: inline-flex; align-items: center; gap: 6px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; }',
      '.jc-paulo-exams .po-pending::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #B8954A; }',
      '.jc-paulo-exams .po-pdf { display: inline-flex; align-items: center; gap: 5px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; border: 1px solid #B8954A; padding: 4px 10px; border-radius: 6px; }',
      '.jc-paulo-exams .po-pdf:hover { background: #FFF6E5; }',
      '.jc-paulo-exams .po-ai { margin-top: 2px; padding: 12px 14px; background: #FFFCF5; border: 1px solid #F0E4C8; border-radius: 8px; }',
      '.jc-paulo-exams .po-ai-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }',
      '.jc-paulo-exams .po-ai-label { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; font-weight: 600; }',
      '.jc-paulo-exams .po-ai-body { font-family: "IBM Plex Sans", sans-serif; font-size: 12.5px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      '.jc-paulo-exams .po-ai-body strong { color: #0D1B2A; }',
      '.jc-paulo-exams .po-ai-body em { font-style: italic; color: #244E6E; }',
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
        '<div class="section-label">' + t('5 · MRI · Spine', '5 · RM · Coluna') + '</div>' +
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
            t('6 · AI longitudinal analysis', '6 · Análise longitudinal por IA') +
          '</div>' +
          '<h2 class="section-title ph-section-title">' +
            t('How cervical and lumbar findings evolved',
              'Como os achados cervicais e lombares evoluíram') +
            ' <span class="ai-pill">AI</span>' +
          '</h2>' +
          '<p class="section-desc">' +
            t('Three cervical MRIs (2015, 2023, 2026) and two lumbar (2023, 2026), all from CETAM Diagnóstico, <strong>newest study first</strong>. Each entry carries an <strong>AI Δ-from-previous read</strong> at the top — what moved, what stabilised, what is genuinely new versus the older study below it — followed by the underlying radiologist&apos;s synthesis. Scroll down each column to trace the findings back to their baseline.',
              'Três RMs cervicais (2015, 2023, 2026) e duas lombares (2023, 2026), todas do CETAM Diagnóstico, <strong>do exame mais recente para o mais antigo</strong>. Cada entrada traz uma <strong>leitura Δ-vs.-anterior da IA</strong> no topo — o que mudou, o que estabilizou, o que é genuinamente novo em relação ao estudo mais antigo logo abaixo — seguida da síntese do radiologista. Desça em cada coluna para acompanhar os achados até a linha de base.') +
          '</p>' +
          '<div class="ph-timeline-grid">' +
            '<div class="ph-timeline">' +
              '<div class="ph-timeline-head">' +
                '<h3 class="ph-timeline-title">' + t('6A · Cervical spine', '6A · Coluna cervical') + '</h3>' +
                '<span class="ph-timeline-span">' + t('2026 → 2015 · 3 studies', '2026 → 2015 · 3 estudos') + '</span>' +
              '</div>' +
              cervical.slice().reverse().map(buildPauloHistoryEntry).join('') +
              '<div class="ph-takeaway">' +
                '<span class="lang-en">The dominant lesion <strong>migrated upward</strong> over eleven years — from C6–C7 (2015) to C5–C6 (2023, still dominant in 2026). What was a focal disc protrusion in 2015 became a <strong>diffuse disco-osteophytic bulge with ventral cord contact</strong> by 2026, with explicit involvement of the uncovertebral and facet joints. Cord signal remains normal — no myelopathy, but the cord is being touched.</span>' +
                '<span class="lang-pt">A lesão dominante <strong>migrou cranialmente</strong> ao longo de onze anos — de C6–C7 (2015) para C5–C6 (2023, ainda dominante em 2026). O que era protrusão discal focal em 2015 tornou-se <strong>abaulamento disco-osteofitário difuso com contato medular ventral</strong> em 2026, com envolvimento explícito das articulações uncovertebrais e facetárias. O sinal medular permanece normal — sem mielopatia, mas a medula está sendo tocada.</span>' +
              '</div>' +
            '</div>' +
            '<div class="ph-timeline">' +
              '<div class="ph-timeline-head">' +
                '<h3 class="ph-timeline-title">' + t('6B · Lumbar spine', '6B · Coluna lombar') + '</h3>' +
                '<span class="ph-timeline-span">' + t('2026 → 2023 · 2 studies', '2026 → 2023 · 2 estudos') + '</span>' +
              '</div>' +
              lumbar.slice().reverse().map(buildPauloHistoryEntry).join('') +
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

  /* Cards render in date-descending order (newest first — house rule for all
     imagery exams), so the 7A/7B/... letters are assigned from the sorted
     position, not stored in the data. */
  function pauloOtherStudyDateMs(c) {
    // Every card's dateEn is 'DD Mon YYYY' (e.g. '23 Nov 2015').
    var M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    var p = (c.dateEn || '').split(' ');
    return Date.UTC(+p[2] || 0, M[p[1]] || 0, +p[0] || 1);
  }

  function buildPauloOtherStudyCard(c, idx) {
    var findingsHtml = (c.findingsEn || []).map(function (_, i) {
      return (
        '<li><span class="lang-en">' + c.findingsEn[i] + '</span>' +
        '<span class="lang-pt">' + c.findingsPt[i] + '</span></li>'
      );
    }).join('');
    var letter = '7' + String.fromCharCode(65 + idx) + ' · ';
    return (
      '<article class="po-card">' +
        '<header class="po-card-head">' +
          '<div>' +
            '<div class="po-card-eyebrow">' + t(letter + c.eyebrowEn, letter + c.eyebrowPt) + '</div>' +
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
        eyebrowEn: 'MRI · Right shoulder',
        eyebrowPt: 'RM · Ombro direito',
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
        eyebrowEn: 'MRI · Right knee',
        eyebrowPt: 'RM · Joelho direito',
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
        eyebrowEn: 'CT · Abdomen & pelvis',
        eyebrowPt: 'TC · Abdome e pelve',
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
        eyebrowEn: 'CT · Cranium',
        eyebrowPt: 'TC · Crânio',
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
        eyebrowEn: 'CT · Face / sinuses',
        eyebrowPt: 'TC · Face / seios',
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
        eyebrowEn: 'MRI · Right hand',
        eyebrowPt: 'RM · Mão direita',
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
        eyebrowEn: 'X-ray · Chest',
        eyebrowPt: 'RX · Tórax',
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
        eyebrowEn: 'X-ray · Chest & sinuses',
        eyebrowPt: 'RX · Tórax e seios da face',
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
        eyebrowEn: 'CT · Chest',
        eyebrowPt: 'TC · Tórax',
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
        eyebrowEn: 'Ultrasound · Abdomen',
        eyebrowPt: 'US · Abdome',
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
        eyebrowEn: 'Ultrasound · Abdomen & prostate',
        eyebrowPt: 'US · Abdome e próstata',
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
        eyebrowEn: 'Ultrasound · Kidneys & urinary tract',
        eyebrowPt: 'US · Rins e vias urinárias',
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
        eyebrowEn: 'Ultrasound · Urinary tract & prostate',
        eyebrowPt: 'US · Vias urinárias e próstata',
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
      {
        eyebrowEn: 'Colonoscopy · Lower GI',
        eyebrowPt: 'Colonoscopia · Trato GI baixo',
        titleEn:   'Total colonoscopy',
        titlePt:   'Colonoscopia total',
        dateEn: '10 Sep 2013',
        datePt: '10 set 2013',
        physician: 'Dr. Marcelo de Mello Torquato · Dr. Roberto Minoru Naito',
        provider:  'Endofasno Imagem · Ribeirão Preto',
        pdfHref: 'scans/paulo-colonoscopy-2013-09-10-report.pdf',
        reportOnly: true,
        findingsEn: [
          'Oral 20% mannitol prep (1000 ml) with good cleansing. Pentax EC-380 colonoscope; IV sedation (midazolam 2.5 mg, meperidine 50 mg). Prior digital rectal exam: normotonic sphincter, no other changes.',
          'Ileocecal-valve mucosa normal. Cecum, ascending colon, hepatic flexure, transverse colon, splenic flexure, descending colon and sigmoid all within <strong>macroscopic normal limits</strong>. Rectal mucosa normal.',
          'Impression: <strong>NORMAL TOTAL COLONOSCOPY</strong>. No biopsies taken.',
        ],
        findingsPt: [
          'Preparo com manitol a 20% por via oral (1000 ml), com bom resultado. Colonoscópio Pentax EC-380; sedação intravenosa (midazolam 2,5 mg, meperidina 50 mg). Toque retal prévio: esfíncter normotônico, sem outras alterações.',
          'Mucosa da válvula íleo-cecal normal. Ceco, cólon ascendente, ângulo hepático, cólon transverso, ângulo esplênico, cólon descendente e sigmoide dentro dos <strong>padrões macroscópicos da normalidade</strong>. Mucosa do reto normal.',
          'Impressão: <strong>ESTUDO COLONOSCÓPICO TOTAL NORMAL</strong>. Sem biópsias.',
        ],
        aiEn: 'A <strong>normal total colonoscopy</strong> — the only endoscopic / lower-GI study on file and Paulo&apos;s clean colon baseline. Every segment from cecum to rectum was macroscopically normal and no biopsy was needed. Its value is longitudinal: the 2022 abdomen / pelvis CT later found <strong>diverticulosis of the descending and sigmoid colon</strong> — segments explicitly normal here in 2013 — dating that diverticular change to the intervening decade rather than something lifelong. Read as routine screening it carries no action of its own; it anchors the GI timeline the later CT builds on.',
        aiPt: 'Uma <strong>colonoscopia total normal</strong> — o único estudo endoscópico / do trato gastrointestinal baixo do histórico e a linha de base limpa do cólon do Paulo. Todos os segmentos, do ceco ao reto, estavam macroscopicamente normais e não houve necessidade de biópsia. Seu valor é longitudinal: a TC de abdome / pelve de 2022 viria a encontrar <strong>diverticulose do cólon descendente e sigmoide</strong> — segmentos aqui explicitamente normais em 2013 —, datando essa alteração diverticular à década seguinte, e não a algo de toda a vida. Lida como rastreamento de rotina, não exige conduta própria; ancora a linha do tempo gastrointestinal sobre a qual a TC posterior se apoia.',
      },
    ];

    cards.sort(function (a, b) { return pauloOtherStudyDateMs(b) - pauloOtherStudyDateMs(a); });

    return (
      '<section class="report-section" id="paulo-other-studies">' +
        '<div class="container">' +
          '<div class="section-label">' +
            t('7 · Other studies on file', '7 · Outros exames disponíveis') +
          '</div>' +
          '<h2 class="section-title">' +
            t('Beyond the spine — thirteen additional reports',
              'Além da coluna — outros treze laudos') +
          '</h2>' +
          '<p class="section-desc">' +
            t('Thirteen additional radiology reports on file, spanning 2013 to 2025 and ordered newest first — peripheral joints (shoulder, knee, hand), chest (X-ray and CT), the abdomen / liver and a four-study urological series, plus the head and face CTs. Each card carries the radiologist&apos;s key findings, an AI read, and the full PDF; these are report-only studies, with no source imagery to view.',
              'Treze laudos de radiologia no histórico, de 2013 a 2025, do exame mais recente para o mais antigo — articulações periféricas (ombro, joelho, mão), tórax (RX e TC), abdome / fígado e uma série urológica de quatro estudos, além das TCs de crânio e face. Cada cartão traz os achados-chave do radiologista, uma leitura da IA e o PDF completo; são estudos somente-laudo, sem imagens de origem para visualizar.') +
          '</p>' +
          '<div class="po-grid">' +
            cards.map(buildPauloOtherStudyCard).join('') +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  /* ── Overall clinical evolution · the major cross-study link ──────
     The capstone synthesis. Sections 1–7 each look at one axis (the
     current snapshot, the two chest CTs, the chest X-ray, the spine viewer,
     the per-region longitudinal arcs, the isolated studies). This ties ALL eighteen studies — spine,
     peripheral joints, chest, abdomen/urological and systemic CT — into
     one thirteen-year clinical story, and surfaces the non-spine
     follow-up that the spine narrative tends to bury. */

  function buildPauloOverallEvolution() {
    return (
      '<section class="paulo-ai-summary-wrap" id="paulo-overall-evolution">' +
        '<div class="container">' +
          '<div class="paulo-ai-summary">' +
            '<header class="paulo-ai-summary-head">' +
              '<h2>' + t('8 · Overall clinical evolution', '8 · Evolução clínica geral') + '</h2>' +
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
    var P = '.jc-paulo-exams ';
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
              '<h2>' + t('9 · AI synthesis · Lab history', '9 · Síntese da IA · Histórico laboratorial') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('Synthesised from 26 blood & urine panels · 11+ laboratories · 2011 to 2024',
                'Sintetizado a partir de 26 painéis de sangue e urina · 11+ laboratórios · 2011 a 2024') +
            '</div>' +
            '<div class="paulo-ai-subhead">' +
              t('Synthesis covers draws through April 2024 · newer panels (Nov 2025, Apr 2026) shown below',
                'Síntese abrange coletas até abril de 2024 · painéis mais recentes (nov 2025, abr 2026) abaixo') +
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
      '.jc-paulo-mental { display: block; background: #F9F7F4; padding: 0 0 64px; }',
      '.jc-paulo-mental .hero { background: #0A1428; color: #fff; padding: 46px 0 50px; }',
      '.jc-paulo-mental .hero .container { max-width: 1000px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-mental .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(244,185,66,0.9); margin-bottom: 10px; }',
      '.jc-paulo-mental .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 34px; line-height: 1.12; margin: 0 0 10px; }',
      '.jc-paulo-mental .hero-sub { color: rgba(255,255,255,0.82); font-size: 16px; line-height: 1.6; margin: 0; max-width: 60ch; }',
      '.jc-paulo-mental .rp-wrap { max-width: 1000px; margin: 0 auto; padding: 0 24px; }',
      '.jc-paulo-mental .rp-frame { margin: 22px auto 0; }',
      '.jc-paulo-mental .rp-frame-inner { background: #fff; border: 1px solid #ECE7DD; border-left: 3px solid #F4B942; border-radius: 10px; padding: 15px 19px; font-family: "Mulish", sans-serif; font-size: 14px; line-height: 1.6; color: #3A4654; }',
      '.jc-paulo-mental .rp-section { margin: 40px auto 0; }',
      '.jc-paulo-mental .rp-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6BA3C7; margin-bottom: 6px; }',
      '.jc-paulo-mental .rp-h { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 21px; color: #0A1428; margin: 0 0 4px; }',
      '.jc-paulo-mental .rp-sub { font-family: "Mulish", sans-serif; font-size: 14px; color: #5A6675; margin: 0 0 18px; line-height: 1.55; }',
      '.jc-paulo-mental .rp-johari { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }',
      '@media (max-width: 680px) { .jc-paulo-mental .rp-johari { grid-template-columns: 1fr; } }',
      '.jc-paulo-mental .rp-jcell { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      '.jc-paulo-mental .rp-jcell.is-empty { background: #F6F4EF; border-style: dashed; }',
      '.jc-paulo-mental .rp-jhead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 6px; }',
      '.jc-paulo-mental .rp-jtitle { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0A1428; }',
      '.jc-paulo-mental .rp-jcount { font-family: "IBM Plex Mono", monospace; font-size: 18px; font-weight: 600; color: #244E6E; }',
      '.jc-paulo-mental .rp-jcell.is-empty .rp-jcount { color: #B6AD98; }',
      '.jc-paulo-mental .rp-jdesc { font-family: "Mulish", sans-serif; font-size: 13px; line-height: 1.5; color: #5A6675; margin: 0; }',
      '.jc-paulo-mental .rp-cards { display: flex; flex-direction: column; gap: 14px; }',
      '.jc-paulo-mental .rp-card { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      '.jc-paulo-mental .rp-card.rp-card-warm { border-left: 3px solid #F4B942; }',
      '.jc-paulo-mental .rp-card.rp-card-care { border-left: 3px solid #6BA3C7; background: #FBFAF7; }',
      '.jc-paulo-mental .rp-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; flex-wrap: wrap; }',
      '.jc-paulo-mental .rp-body { font-family: "Mulish", sans-serif; font-size: 15.5px; line-height: 1.62; color: #24323F; margin: 0; }',
      '.jc-paulo-mental .rp-evidence { font-family: "Mulish", sans-serif; font-size: 13px; font-style: italic; color: #7A8694; margin: 10px 0 0; padding-left: 10px; border-left: 2px solid #E2DCCF; }',
      '.jc-paulo-mental .rp-chip { display: inline-flex; align-items: center; gap: 5px; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid transparent; }',
      '.jc-paulo-mental .rp-chip-other { background: #EAF2F7; color: #244E6E; border-color: #CFE0EB; }',
      '.jc-paulo-mental .rp-chip-self { background: #FCF3DC; color: #8A6A18; border-color: #F4DD9C; }',
      '.jc-paulo-mental .rp-chip-ai { background: #FDF8EC; color: #6B4FA0; border-color: #F4DD9C; }',
      '.jc-paulo-mental .ai-pill { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; background: #6B4FA0; color: #fff; padding: 1px 5px; border-radius: 4px; }',
      '.jc-paulo-mental .rp-respond { margin-top: 14px; padding-top: 12px; border-top: 1px dashed #E7E2D8; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.jc-paulo-mental .rp-respond-q { font-family: "Mulish", sans-serif; font-size: 12.5px; color: #7A8694; margin-right: 2px; }',
      '.jc-paulo-mental .rp-btn { font-family: "Mulish", sans-serif; font-size: 13px; color: #244E6E; background: #fff; border: 1px solid #CFD8DF; border-radius: 999px; padding: 5px 12px; cursor: pointer; transition: all 0.12s; }',
      '.jc-paulo-mental .rp-btn:hover { border-color: #6BA3C7; }',
      '.jc-paulo-mental .rp-btn.is-active { background: #244E6E; color: #fff; border-color: #244E6E; }',
      '.jc-paulo-mental .rp-note-box { flex-basis: 100%; margin-top: 8px; display: flex; gap: 8px; }',
      '.jc-paulo-mental .rp-note-input { flex: 1; font-family: "Mulish", sans-serif; font-size: 14px; padding: 8px 10px; border: 1px solid #CFD8DF; border-radius: 8px; resize: vertical; min-height: 56px; }',
      '.jc-paulo-mental .rp-note-save { align-self: flex-start; font-family: "Mulish", sans-serif; font-size: 13px; background: #F4B942; color: #0A1428; border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer; }',
      '.jc-paulo-mental .rp-status { flex-basis: 100%; font-family: "Mulish", sans-serif; font-size: 12px; color: #3E7D5A; margin-top: 4px; min-height: 14px; }',
      '.jc-paulo-mental .rp-support { margin-top: 12px; background: #EAF2F7; border: 1px solid #CFE0EB; border-radius: 8px; padding: 10px 12px; font-family: "Mulish", sans-serif; font-size: 13px; line-height: 1.55; color: #244E6E; }',
      '.jc-paulo-mental details.rp-collapse { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; margin-top: 14px; overflow: hidden; }',
      '.jc-paulo-mental details.rp-collapse > summary { list-style: none; cursor: pointer; padding: 14px 18px; display: flex; align-items: center; gap: 8px; font-family: "Raleway", sans-serif; font-weight: 600; font-size: 15px; color: #0A1428; }',
      '.jc-paulo-mental details.rp-collapse > summary::-webkit-details-marker { display: none; }',
      '.jc-paulo-mental details.rp-collapse[open] > summary { border-bottom: 1px solid #EFEADF; }',
      '.jc-paulo-mental .rp-collapse-body { padding: 8px 18px 18px; }',
      '.jc-paulo-mental .rp-dismiss { margin-left: auto; font-family: "Mulish", sans-serif; font-size: 12px; color: #9AA4B0; background: none; border: none; cursor: pointer; }',
      '.jc-paulo-mental .rp-reading { display: flex; flex-direction: column; gap: 12px; }',
      '.jc-paulo-mental .rp-q { background: #fff; border: 1px solid #E7E2D8; border-left: 3px solid #6BA3C7; border-radius: 10px; padding: 14px 18px; font-family: "Mulish", sans-serif; font-size: 16px; line-height: 1.55; color: #24323F; }',
      '.jc-paulo-mental .rp-pillars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      '@media (max-width: 680px) { .jc-paulo-mental .rp-pillars { grid-template-columns: 1fr; } }',
      '.jc-paulo-mental .rp-pillar { background: #fff; border: 1px solid #E7E2D8; border-radius: 10px; padding: 16px 18px; }',
      '.jc-paulo-mental .rp-pillar.is-tbd { background: #F6F4EF; }',
      '.jc-paulo-mental .rp-pillar-label { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6BA3C7; margin-bottom: 6px; }',
      '.jc-paulo-mental .rp-pillar.is-tbd .rp-pillar-label { color: #B6AD98; }',
      '.jc-paulo-mental .rp-pillar-body { font-family: "Mulish", sans-serif; font-size: 14px; line-height: 1.55; color: #3A4654; margin: 0; }',
      '.jc-paulo-mental .rp-cta { margin: 40px auto 0; }',
      '.jc-paulo-mental .rp-cta-inner { background: #0A1428; color: #fff; border-radius: 12px; padding: 26px 28px; }',
      '.jc-paulo-mental .rp-cta-h { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 19px; margin: 0 0 8px; }',
      '.jc-paulo-mental .rp-cta-p { font-family: "Mulish", sans-serif; font-size: 14.5px; line-height: 1.6; color: rgba(255,255,255,0.85); margin: 0; }',
      '.jc-paulo-mental .rp-loading { margin: 40px auto; font-family: "Mulish", sans-serif; color: #7A8694; }',
      '.jc-paulo-mental .pm-transcript p { font-family: "Mulish", sans-serif; font-size: 15px; line-height: 1.7; color: #34414E; margin: 0 0 16px; }'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'paulo-mental-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* Paulo's reflective portrait, now an assembler provider: returns the
     container immediately (loading state) and fills it from /api/reflective.
     The dark portrait banner stays as section-level chrome; the page hero,
     tail and footer are assembler-owned. */
  function renderPauloMental() {
    /* Scope proxy: paulo-mental.js is a GATED_ASSETS file (mental scope on
       Paulo). A viewer whose grant lacks `mental` gets a 403 and no global —
       render nothing instead of a hero + permanent error stub (I-5). */
    if (!window.PAULO_MENTAL_NARRATIVE) return null;
    injectPauloMentalStyles();

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

    var main = document.createElement('div');
    main.className = 'jc-paulo-mental';
    main.innerHTML = heroHtml() +
      '<div class="rp-loading rp-wrap"><span class="lang-en">Assembling the portrait…</span><span class="lang-pt">Montando o retrato…</span></div>';

    fetch('/api/reflective?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      })
      .then(function (data) {
        main.innerHTML = heroHtml() + buildPortrait(data);
        wireResponders(main);
      })
      .catch(function (err) {
        /* Denied (no mental scope): remove the already-mounted section so a
           failing gate emits nothing; keep the stub for transient failures. */
        if (err && (err.status === 401 || err.status === 403)) {
          if (main.parentNode) main.parentNode.removeChild(main);
          return;
        }
        main.innerHTML = heroHtml() +
          '<div class="rp-loading rp-wrap"><span class="lang-en">This portrait could not be loaded right now.</span><span class="lang-pt">Não foi possível carregar este retrato agora.</span></div>';
      });

    return main;
  }

  function renderPauloLabsSection() {
    var L = window.PAULO_LABS;
    if (!L || !L.panels || !L.panels.length) return '';
    injectPauloLabsStyles();
    var nMarkers = L.panels.reduce(function (a, p) { return a + p.markers.length; }, 0);

    var head =
      '<div class="container">' +
        '<div class="section-label">' + t('9 · Laboratory', '9 · Laboratorial') + '</div>' +
        '<h2 class="section-title">' + t('Laboratory exams', 'Exames laboratoriais') + '</h2>' +
        '<p class="section-desc">' +
          t('Fifteen years of blood and urine work (2011-2026), reconciled from 28 scanned reports across 11+ laboratories into ' + nMarkers + ' markers grouped by panel. Each card shows the latest value with its reference bar and an expandable per-marker history; the full side-by-side comparison sits at the bottom, most recent at left. Original reports are linked beneath.',
            'Quinze anos de exames de sangue e urina (2011-2026), reconciliados de 28 laudos digitalizados de 11+ laboratórios em ' + nMarkers + ' marcadores agrupados por painel. Cada cartão mostra o valor mais recente com sua barra de referência e um histórico por marcador expansível; a comparação completa lado a lado fica ao final, mais recente à esquerda. Os laudos originais estão linkados abaixo.') +
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
    var P = '.jc-paulo-exams ';
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
              '<h2>' + t('10 · AI synthesis · Ergometric series', '10 · Síntese da IA · Série ergométrica') + '</h2>' +
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
        '<div class="section-label">' + t('10 · Cardiac', '10 · Cardíaco') + '</div>' +
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

  /* ── Paulo Silotto · sleep medicine (PSG + DISE) ──────────────────────
     Reads window.PAULO_SLEEP (assets/paulo-sleep.js): a 2017 whole-night
     polysomnogram (mild OSA) and a 2019 drug-induced sleep endoscopy. Both
     sourced verbatim from the original reports. Renders an AHI severity
     readout (PSG), a VOTE airway readout (DISE), AI interpretive blocks
     (ai-pill), and verbatim PT transcripts behind collapsibles. */
  function injectPauloSleepStyles() {
    if (document.getElementById('paulo-sleep-styles')) return;
    var s = document.createElement('style');
    s.id = 'paulo-sleep-styles';
    var P = '.jc-paulo-exams ';
    s.textContent = [
      P + '.pl-sleep-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-left: 3px solid #244E6E; border-radius: 10px; padding: 20px 22px; margin-top: 14px; }',
      P + '.pl-sleep-card.is-dise { border-left-color: #7A4E9E; }',
      P + '.pl-sleep-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 4px; }',
      P + '.pl-sleep-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 0; }',
      P + '.pl-sleep-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; letter-spacing: 0.04em; }',
      P + '.pl-sleep-tag { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: rgba(36, 78, 110, 0.10); color: #244E6E; }',
      P + '.pl-sleep-tag.is-dise { background: rgba(122, 78, 158, 0.12); color: #6A3E8E; }',
      // AHI severity readout
      P + '.pl-ahi { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin: 16px 0 6px; }',
      P + '.pl-ahi-num { font-family: "Raleway", sans-serif; font-weight: 800; font-size: 40px; line-height: 1; color: #0D1B2A; }',
      P + '.pl-ahi-num small { font-family: "IBM Plex Mono", monospace; font-size: 13px; font-weight: 500; color: #7A8FA6; }',
      P + '.pl-ahi-verdict { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }',
      P + '.pl-ahi-verdict.sev-normal { background: rgba(45,122,78,0.12); color: #1F6E45; }',
      P + '.pl-ahi-verdict.sev-mild { background: rgba(184,149,74,0.16); color: #8A6A1F; }',
      P + '.pl-ahi-verdict.sev-moderate { background: rgba(201,123,58,0.16); color: #9A4E16; }',
      P + '.pl-ahi-verdict.sev-severe { background: rgba(178,52,52,0.14); color: #9A2A2A; }',
      P + '.pl-ahi-meter { position: relative; height: 30px; margin: 6px 0 18px; }',
      P + '.pl-ahi-bands { display: flex; height: 8px; border-radius: 4px; overflow: hidden; }',
      P + '.pl-ahi-bands span { display: block; }',
      P + '.pl-ahi-bands .b-normal { background: #BFE0CC; }',
      P + '.pl-ahi-bands .b-mild { background: #EBD7A6; }',
      P + '.pl-ahi-bands .b-moderate { background: #E6BE97; }',
      P + '.pl-ahi-bands .b-severe { background: #E2A6A6; }',
      P + '.pl-ahi-mark { position: absolute; top: -3px; width: 2px; height: 14px; background: #0D1B2A; }',
      P + '.pl-ahi-mark::after { content: ""; position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #0D1B2A; }',
      P + '.pl-ahi-scale { display: flex; justify-content: space-between; font-family: "IBM Plex Mono", monospace; font-size: 9px; color: #9AA7B4; margin-top: 10px; }',
      // chips
      P + '.pl-sleep-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; margin-top: 6px; }',
      P + '.pl-sleep-chip { background: #F4F1EA; border: 1px solid #E5E2DC; border-radius: 8px; padding: 9px 11px; }',
      P + '.pl-sleep-chip-k { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 3px; }',
      P + '.pl-sleep-chip-v { display: block; font-family: "IBM Plex Sans", sans-serif; font-size: 15px; font-weight: 600; color: #0D1B2A; }',
      P + '.pl-sleep-chip-v small { font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; color: #7A8FA6; }',
      // VOTE readout
      P + '.pl-vote { margin: 14px 0 4px; }',
      P + '.pl-vote-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid #EFEBE3; }',
      P + '.pl-vote-letter { flex: 0 0 30px; height: 30px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-family: "Raleway", sans-serif; font-weight: 800; font-size: 15px; color: #FFFFFF; }',
      P + '.pl-vote-d0 .pl-vote-letter { background: #2D7A4E; }',
      P + '.pl-vote-d1 .pl-vote-letter { background: #C97B3A; }',
      P + '.pl-vote-d2 .pl-vote-letter { background: #B23434; }',
      P + '.pl-vote-site { flex: 1 1 auto; }',
      P + '.pl-vote-site-name { font-family: "IBM Plex Sans", sans-serif; font-weight: 600; font-size: 14px; color: #0D1B2A; }',
      P + '.pl-vote-site-cfg { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',
      P + '.pl-vote-deg { flex: 0 0 auto; font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }',
      P + '.pl-vote-d0 .pl-vote-deg { background: rgba(45,122,78,0.12); color: #1F6E45; }',
      P + '.pl-vote-d1 .pl-vote-deg { background: rgba(201,123,58,0.14); color: #9A4E16; }',
      P + '.pl-vote-d2 .pl-vote-deg { background: rgba(178,52,52,0.14); color: #9A2A2A; }',
      P + '.pl-vote-code { font-family: "IBM Plex Mono", monospace; font-weight: 700; }',
      P + '.pl-vote-ref { font-family: "IBM Plex Mono", monospace; font-size: 9px; color: #9AA7B4; margin-top: 8px; }',
      // maneuvers
      P + '.pl-man { list-style: none; padding: 0; margin: 14px 0 0; }',
      P + '.pl-man li { position: relative; padding-left: 22px; font-size: 13px; line-height: 1.5; color: #1E2D3D; margin-bottom: 8px; }',
      P + '.pl-man li::before { position: absolute; left: 0; top: 0; font-family: "IBM Plex Mono", monospace; font-size: 13px; }',
      P + '.pl-man li.is-good::before { content: "\\2197"; color: #1F6E45; }',
      P + '.pl-man li.is-bad::before { content: "\\2192"; color: #9AA7B4; }',
      // AI interpretive block
      P + '.pl-sleep-ai { background: #FBF8F1; border: 1px solid #E8DEC6; border-radius: 9px; padding: 14px 16px; margin-top: 16px; }',
      P + '.pl-sleep-ai-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }',
      P + '.pl-sleep-ai-head .ai-pill { font-family: "IBM Plex Mono", monospace; font-size: 9px; letter-spacing: 0.08em; background: #B8954A; color: #FFFFFF; padding: 2px 7px; border-radius: 999px; }',
      P + '.pl-sleep-ai-head span.k { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #8A6A1F; }',
      P + '.pl-sleep-ai p { font-size: 13.5px; line-height: 1.6; color: #1E2D3D; margin: 0; }',
      P + '.pl-sleep-note { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #9AA7B4; margin-top: 10px; }',
      // transcript
      P + '.pl-sleep-card .silv-hist { margin-top: 14px; }',
      P + '.pl-sleep-verbatim { white-space: pre-wrap; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; margin: 8px 0 4px; }',
      P + '.pl-sleep-verbatim-h { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; margin: 12px 0 2px; }',
      P + '.pl-sleep-pdf { display: inline-block; margin-top: 12px; font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; text-decoration: none; border-bottom: 1px solid rgba(36,78,110,0.3); }',
      '@media (prefers-reduced-motion: reduce) { ' + P + '.silv-hist { transition: none; } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function renderPauloSleepSection() {
    var S = window.PAULO_SLEEP;
    if (!S || (!S.psg && !S.dise)) return '';
    injectPauloSleepStyles();
    var fmt = function (v) { return (v === null || v === undefined) ? '—' : v; };
    var chip = function (k, v) {
      return '<div class="pl-sleep-chip"><span class="pl-sleep-chip-k">' + k + '</span><span class="pl-sleep-chip-v">' + v + '</span></div>';
    };

    // ── PSG card ──
    var psgHtml = '';
    if (S.psg) {
      var p = S.psg;
      var sevClass = 'sev-' + p.severity;
      var markPct = Math.min(p.ahi, 40) / 40 * 100;
      var meter =
        '<div class="pl-ahi-meter">' +
          '<div class="pl-ahi-bands">' +
            '<span class="b-normal" style="width:12.5%"></span>' +
            '<span class="b-mild" style="width:25%"></span>' +
            '<span class="b-moderate" style="width:37.5%"></span>' +
            '<span class="b-severe" style="width:25%"></span>' +
          '</div>' +
          '<div class="pl-ahi-mark" style="left:' + markPct.toFixed(1) + '%"></div>' +
          '<div class="pl-ahi-scale"><span>0</span><span>5</span><span>15</span><span>30</span><span>40+</span></div>' +
        '</div>';
      var psgChips =
        chip(t('Efficiency', 'Eficiência'), p.efficiency + '<small>%</small>') +
        chip(t('Total sleep', 'Sono total'), p.tst_min + '<small> min</small>') +
        chip(t('SpO₂ nadir', 'SpO₂ mínima'), p.spo2_nadir + '<small>%</small>') +
        chip(t('Snore index', 'Índice ronco'), p.snore_index + '<small>/h</small>') +
        chip(t('Arousal index', 'Índice despertar'), p.arousal_index + '<small>/h</small>') +
        chip(t('Desaturations', 'Dessaturações'), p.desaturations) +
        chip('ODI / IDO', fmt(p.odi)) +
        chip(t('Max event', 'Evento máx'), p.max_event_s + '<small> s</small>');
      var events = t('Events', 'Eventos') + ': ' + p.events.total + ' (' + p.events.obstructive + ' ' + t('obstructive', 'obstrutivos') + ', ' + p.events.central + ' ' + t('central', 'centrais') + ', ' + p.events.mixed + ' ' + t('mixed', 'mistos') + ', ' + p.events.hypopnea + ' ' + t('hypopnoea', 'hipopneias') + ') · ' + p.rera + ' RERA';
      psgHtml =
        '<div class="pl-sleep-card">' +
          '<div class="pl-sleep-head">' +
            '<h3 class="pl-sleep-title">' + t('Polysomnography', 'Polissonografia') + ' · ' +
              '<span class="lang-en">' + p.dateLabelEn + '</span><span class="lang-pt">' + p.dateLabelPt + '</span></h3>' +
            '<span class="pl-sleep-tag">PSG</span>' +
            '<span class="pl-sleep-meta">' + p.lab + ' · ' + p.city + ' · ' + p.performing_doctor + '</span>' +
          '</div>' +
          '<div class="pl-ahi">' +
            '<div class="pl-ahi-num">' + p.ahi + ' <small>' + t('AHI /h', 'IAH /h') + '</small></div>' +
            '<div class="pl-ahi-verdict ' + sevClass + '"><span class="lang-en">' + p.severityEn + '</span><span class="lang-pt">' + p.severityPt + '</span></div>' +
          '</div>' +
          meter +
          '<p class="pl-sleep-meta" style="margin:0 0 10px;">' + events + ' · ' + t('obstructive AHI', 'IAH obstrutivo') + ' ' + p.ahi_obstructive + ' · ' + t('hypopnoea AHI', 'IAH hipopneia') + ' ' + p.ahi_hypopnea + '</p>' +
          '<div class="pl-sleep-chips">' + psgChips + '</div>' +
          '<p class="pl-sleep-note"><span class="lang-en">' + p.stagingNoteEn + '</span><span class="lang-pt">' + p.stagingNotePt + '</span></p>' +
          '<div class="pl-sleep-ai">' +
            '<div class="pl-sleep-ai-head"><span class="ai-pill">AI</span><span class="k">' + t('Interpretation', 'Interpretação') + '</span></div>' +
            '<p class="lang-en">' + p.aiEn + '</p><p class="lang-pt">' + p.aiPt + '</p>' +
          '</div>' +
          '<details class="silv-hist">' +
            '<summary>' + t('Physician report · verbatim transcript', 'Laudo médico · transcrição literal') + '</summary>' +
            '<div class="pl-sleep-verbatim-h">Comentários</div>' +
            '<p class="pl-sleep-verbatim">' + p.verbatim.comentarios + '</p>' +
            '<div class="pl-sleep-verbatim-h">Conclusão</div>' +
            '<p class="pl-sleep-verbatim">' + p.verbatim.conclusao + '</p>' +
            (p.reportHref ? '<a class="pl-sleep-pdf" href="' + p.reportHref + '" target="_blank" rel="noopener">' + t('Open original PDF ↗', 'Abrir PDF original ↗') + '</a>' : '') +
          '</details>' +
        '</div>';
    }

    // ── DISE card ──
    var diseHtml = '';
    if (S.dise) {
      var d = S.dise;
      var voteRows = d.vote.map(function (v) {
        return '<div class="pl-vote-row pl-vote-d' + v.degree + '">' +
          '<div class="pl-vote-letter">' + v.letter + '</div>' +
          '<div class="pl-vote-site">' +
            '<div class="pl-vote-site-name"><span class="lang-en">' + v.site_en + '</span><span class="lang-pt">' + v.site_pt + '</span>' +
              (v.config ? ' <span class="pl-vote-code">' + v.degree + v.config + '</span>' : ' <span class="pl-vote-code">' + v.degree + '</span>') + '</div>' +
            '<div class="pl-vote-site-cfg"><span class="lang-en">' + v.label_en + '</span><span class="lang-pt">' + v.label_pt + '</span></div>' +
          '</div>' +
          '<div class="pl-vote-deg">' + (v.degree === 0 ? t('none', 'ausente') : v.degree === 1 ? t('partial', 'parcial') : t('complete', 'completa')) + '</div>' +
        '</div>';
      }).join('');
      var manRows = d.maneuvers.map(function (mv) {
        return '<li class="' + (mv.good ? 'is-good' : 'is-bad') + '">' +
          '<strong><span class="lang-en">' + mv.en + '</span><span class="lang-pt">' + mv.pt + '</span></strong> — ' +
          '<span class="lang-en">' + mv.resultEn + '</span><span class="lang-pt">' + mv.resultPt + '</span></li>';
      }).join('');
      diseHtml =
        '<div class="pl-sleep-card is-dise">' +
          '<div class="pl-sleep-head">' +
            '<h3 class="pl-sleep-title">' + t('Sleep endoscopy (DISE)', 'Sonoendoscopia (DISE)') + ' · ' +
              '<span class="lang-en">' + d.dateLabelEn + '</span><span class="lang-pt">' + d.dateLabelPt + '</span></h3>' +
            '<span class="pl-sleep-tag is-dise">DISE</span>' +
            '<span class="pl-sleep-meta">' + d.performing_doctor + ' · ' + t('ref.', 'atend.') + ' ' + d.attendance + '</span>' +
          '</div>' +
          '<p class="pl-sleep-meta" style="margin:6px 0 0;">' +
            '<span class="lang-en">' + d.route_en + '</span><span class="lang-pt">' + d.route_pt + '</span> · ' +
            d.sedation.agent + ' ' + d.sedation.conc + ' · BIS ' + d.sedation.bis + ' · ' +
            '<span class="lang-en">' + d.sedation.topical_en + '</span><span class="lang-pt">' + d.sedation.topical_pt + '</span></p>' +
          '<div class="pl-vote">' + voteRows +
            '<div class="pl-vote-ref">' + d.voteRef + '</div>' +
          '</div>' +
          '<ul class="pl-man">' + manRows + '</ul>' +
          '<div class="pl-sleep-ai">' +
            '<div class="pl-sleep-ai-head"><span class="ai-pill">AI</span><span class="k">' + t('Interpretation', 'Interpretação') + '</span></div>' +
            '<p class="lang-en">' + d.aiEn + '</p><p class="lang-pt">' + d.aiPt + '</p>' +
          '</div>' +
          '<details class="silv-hist">' +
            '<summary>' + t('Physician report · verbatim transcript', 'Laudo médico · transcrição literal') + '</summary>' +
            '<div class="pl-sleep-verbatim-h">Endoscopia do sono induzido</div>' +
            '<p class="pl-sleep-verbatim">' + d.verbatim.procedimento + '</p>' +
            '<div class="pl-sleep-verbatim-h">Descrição sumária do exame</div>' +
            '<p class="pl-sleep-verbatim">' + d.verbatim.descricao_sumaria + '</p>' +
            '<div class="pl-sleep-verbatim-h">Manobras</div>' +
            '<p class="pl-sleep-verbatim">' + d.verbatim.manobras + '</p>' +
            '<div class="pl-sleep-verbatim-h">Classificação VOTE</div>' +
            '<p class="pl-sleep-verbatim">' + d.verbatim.vote + '</p>' +
            (d.reportHref ? '<a class="pl-sleep-pdf" href="' + d.reportHref + '" target="_blank" rel="noopener">' + t('Open original PDF ↗', 'Abrir PDF original ↗') + '</a>' : '') +
          '</details>' +
        '</div>';
    }

    var head =
      '<div class="container">' +
        '<div class="section-label">' + t('12 · Sleep medicine', '12 · Medicina do sono') + '</div>' +
        '<h2 class="section-title">' + t('Sleep studies', 'Estudos do sono') + '</h2>' +
        '<p class="section-desc">' +
          t('Two studies two years apart: a 2017 whole-night polysomnogram establishing mild obstructive sleep apnoea, and a 2019 drug-induced sleep endoscopy (DISE) mapping where the airway actually collapses. Each shows an at-a-glance readout — AHI severity for the PSG, the VOTE airway grade for the DISE — with the physicians’ original reports preserved verbatim underneath.',
            'Dois exames com dois anos de intervalo: uma polissonografia de noite inteira de 2017 que estabelece uma apneia obstrutiva do sono leve, e uma sonoendoscopia (DISE) de 2019 que mapeia onde a via aérea de fato colapsa. Cada um traz uma leitura imediata — gravidade do IAH na PSG, o grau VOTE da via aérea na DISE — com os laudos originais dos médicos preservados literalmente abaixo.') +
        '</p>' +
      '</div>';

    return (
      '<section class="report-section" id="sleep">' +
        head +
        '<div class="container">' + psgHtml + diseHtml + '</div>' +
      '</section>'
    );
  }

  /* Paulo Silotto's bespoke exams content, now an assembler provider: the
     assembler owns the hero/title/tail; this returns the topic content
     (registered under physical-exams ONLY — his other physical sub-pages
     fall through to the default registry gates, fixing the old sub-route
     collapse by construction).                                            */
  function renderPauloPhysicalExams() {
    injectPauloExamsStyles();

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
            t('5 · Imagery · Spine MRI', '5 · Imagem · RM da coluna') +
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

    // ── Chest CT with contrast · 10 Jul 2026 (HURP, Ribeirão Preto) ─────
    // Ingested via the Imagery prompt: DICOM -> windowed JPEG previews +
    // ways/stacks manifest (window x plane, both segmented). Scout and dose
    // summary excluded. Report PDF + extracted text live in the manifest;
    // imaging_studies row scans/paulo-chest-ct-2026-07-10.
    var chestCtContrast =
      '<section class="report-section" id="chest-ct-2026-07-10">' +
        '<div class="container">' +
          '<div class="section-label">' + t('2 · Imagery · Chest CT (contrast)', '2 · Imagem · TC de tórax (contraste)') + '</div>' +
          '<h2 class="section-title">' + t('Chest CT with contrast · 10 July 2026', 'TC de tórax com contraste · 10 de julho de 2026') + '</h2>' +
          '<p class="section-desc">' +
            t('Contrast-enhanced multidetector chest CT — the follow-up, four days later, to the 6 July non-contrast study below. Pick the <strong>Window</strong> (mediastinal soft-tissue, lung parenchyma, vascular MIP, or the thin 1&nbsp;mm reconstructions) and the <strong>Plane</strong> (axial / coronal / sagittal), then scrub the slider, scroll, drag, or use the arrow keys. The thin 1&nbsp;mm windows are axial-only. The radiologist&apos;s findings and conclusion follow below; the original laudo is available to download.',
              'TC de tórax multidetectores com contraste endovenoso — o seguimento, quatro dias depois, do estudo sem contraste de 6 de julho logo abaixo. Escolha a <strong>Janela</strong> (mediastino / partes moles, parênquima pulmonar, MIP vascular ou as reconstruções finas de 1&nbsp;mm) e o <strong>Plano</strong> (axial / coronal / sagital) e depois deslize o controle, role, arraste ou use as setas. As janelas finas de 1&nbsp;mm são apenas axiais. Os achados e a conclusão do radiologista seguem abaixo; o laudo original está disponível para download.') +
          '</p>' +
          '<div class="report-export-row">' +
            '<a class="export-btn-primary" href="scans/paulo-chest-ct-2026-07-10/report.pdf?v=1" download>' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
              t('Export report (PDF)', 'Exportar laudo (PDF)') +
            '</a>' +
          '</div>' +
          '<div class="ct-grid ct-grid-single">' +
            '<div class="ct-viewer" data-prefix="scans/paulo-chest-ct-2026-07-10/" data-manifest="scans/paulo-chest-ct-2026-07-10/manifest.json?v=1">' +
              '<div class="ct-viewer-head">' +
                '<div class="ct-viewer-title">' + t('Window · plane viewer', 'Visualizador por janela e plano') + '</div>' +
                '<div class="ct-viewer-meta">' + t('Image', 'Imagem') + ' <span class="ct-idx">1</span> / <span class="ct-total">1</span></div>' +
              '</div>' +
              '<div class="ct-controls"></div>' +
              '<div class="ct-stage"><img class="ct-img" alt="Contrast chest CT image" loading="lazy"></div>' +
              '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="Contrast chest CT image">' +
            '</div>' +
          '</div>' +
          '<h3 style="font-family:\'Raleway\',sans-serif;font-size:20px;font-weight:700;color:var(--blue-800);margin:2.5rem 0 0.75rem;">' +
            t('Radiologist&apos;s report', 'Laudo do radiologista') + ' <span class="mono" style="color:var(--text-muted);font-size:12px;font-weight:400;letter-spacing:0.06em;">' + t('(translated)', '(traduzido)') + '</span>' +
          '</h3>' +
          '<div class="two-col mb-3">' +
            '<div class="list-card">' +
              '<h4>' + t('Identifiers', 'Identificadores') + '</h4>' +
              '<ul>' +
                '<li><strong>' + t('Patient.', 'Paciente.') + '</strong> Paulo Augusto Silotto Dias de Souza</li>' +
                '<li><strong>' + t('DOB.', 'Nascimento.') + '</strong> ' + t('14 July 1961', '14 de julho de 1961') + '</li>' +
                '<li><strong>' + t('Exam date.', 'Data do exame.') + '</strong> ' + t('10 July 2026 · 19:09', '10 de julho de 2026 · 19:09') + '</li>' +
                '<li><strong>' + t('Exam.', 'Exame.') + '</strong> ' + t('Chest CT with IV contrast', 'TC de tórax com contraste EV') + '</li>' +
                '<li><strong>' + t('Accession.', 'Identificador.') + '</strong> 1056973 · ' + t('MRN', 'Prontuário') + ' 91619</li>' +
                '<li><strong>' + t('Requesting physician.', 'Médico solicitante.') + '</strong> Dr. Helton de Oliveira Couto</li>' +
                '<li><strong>' + t('Reporting physician.', 'Médico responsável.') + '</strong> Dr. Gregory Martins Garcia · CRM 184406</li>' +
                '<li><strong>' + t('Institution.', 'Instituição.') + '</strong> HURP · Hospital Unimed Ribeirão Preto · ' + t('Imaging Diagnostic Centre', 'Centro de Diagnóstico por Imagem') + '</li>' +
                '<li><strong>' + t('Scanner.', 'Equipamento.') + '</strong> Canon Medical Systems · Aquilion Lightning</li>' +
              '</ul>' +
            '</div>' +
            '<div class="list-card">' +
              '<h4>' + t('Technique', 'Técnica') + '</h4>' +
              '<ul>' +
                '<li>' + t('Helical multidetector chest CT.', 'TC helicoidal multidetectores do tórax.') + '</li>' +
                '<li>' + t('Images acquired after intravenous administration of iodinated contrast medium.', 'Imagens obtidas após a administração endovenosa de meio de contraste iodado.') + '</li>' +
                '<li>' + t('11 diagnostic reconstructions: mediastinal 5 mm, lung 3 mm and vascular MIP 20 mm in the three planes, plus thin 1 mm axial series.', '11 reconstruções diagnósticas: mediastino 5 mm, pulmão 3 mm e MIP vascular 20 mm nos três planos, além das séries axiais finas de 1 mm.') + '</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
          '<div class="list-card mb-3">' +
            '<h4>' + t('Findings', 'Achados') + '</h4>' +
            '<ul>' +
              '<li><strong>' + t('Bronchi.', 'Brônquios.') + '</strong> ' + t('<strong>Bilaterally thickened bronchial walls</strong>.', '<strong>Paredes brônquicas espessadas bilateralmente</strong>.') + '</li>' +
              '<li><strong>' + t('Lung parenchyma.', 'Parênquima pulmonar.') + '</strong> ' + t('<strong>Nonspecific 3 mm pulmonary micronodule</strong> in the left segment X (posterior-basal).', '<strong>Micronódulo pulmonar de 3 mm, inespecífico</strong>, em segmento X esquerdo (póstero-basal).') + '</li>' +
              '<li><strong>' + t('Pulmonary vasculature.', 'Trama vascular pulmonar.') + '</strong> ' + t('Usual appearance.', 'Aspecto habitual.') + '</li>' +
              '<li><strong>' + t('Pleural spaces.', 'Cavidades pleurais.') + '</strong> ' + t('No effusions or thickening.', 'Sem derrames ou espessamentos.') + '</li>' +
              '<li><strong>' + t('Cardiovascular.', 'Estruturas cardiovasculares.') + '</strong> ' + t('<strong>Aortic, supra-aortic and coronary atheromatosis</strong>.', '<strong>Ateromatose aórtica, supra-aórtica e coronariana</strong>.') + '</li>' +
              '<li><strong>' + t('Mediastinum.', 'Mediastino.') + '</strong> ' + t('No lymphadenopathy or masses.', 'Sem linfonodopatias ou massas.') + '</li>' +
              '<li><strong>' + t('Diaphragm.', 'Diafragma.') + '</strong> ' + t('Small left posterior diaphragmatic hernia containing fat.', 'Pequena hérnia diafragmática posterior à esquerda, contendo gordura.') + '</li>' +
              '<li><strong>' + t('Bone &amp; soft tissues.', 'Arcabouço ósseo e partes moles.') + '</strong> ' + t('Degenerative changes of the vertebral column; soft tissues unremarkable.', 'Alterações degenerativas da coluna vertebral; partes moles sem alterações.') + '</li>' +
            '</ul>' +
          '</div>' +
          '<div class="alert alert-warn">' +
            '<strong>' + t('Conclusion:', 'Conclusão:') + '</strong> ' +
            t(' <strong>Bronchopathy. Nonspecific left pulmonary micronodule.</strong> Remaining findings as described.', ' <strong>Broncopatia. Micronódulo pulmonar esquerdo inespecífico.</strong> Demais achados vide descrição.') +
          '</div>' +
          '<div class="list-card ai-insight-card mb-3">' +
            '<h4><span class="ai-pill">' + t('AI summary', 'Resumo por IA') + '</span> ' + t('Plain-language read', 'Leitura em linguagem simples') + '</h4>' +
            '<p style="font-size:14px;color:var(--text-secondary);line-height:1.65;">' +
              '<span class="lang-en">This contrast-enhanced CT largely confirms the 6 July study: the main finding is again <strong>thickened airway walls (bronchopathy)</strong> — a chronic airway-inflammation pattern, not something acute — and the contrast adds reassurance where it matters most: <strong>no enlarged lymph nodes, no masses, clear pleural spaces and normal pulmonary vessels</strong>. One new detail: a <strong>3 mm micronodule</strong> in the left lower lobe. Nodules this small are very common incidental findings and are usually benign; guidelines generally call for no routine follow-up at this size in low-risk patients — your doctor may simply re-check it on a future scan. Repeat observations: mild atherosclerosis <strong>including the coronary arteries</strong> (worth keeping in view for cardiovascular prevention), wear-and-tear changes in the spine, and a small fat-containing diaphragmatic hernia (a common, usually harmless finding).</span>' +
              '<span class="lang-pt">Esta TC com contraste em grande parte confirma o estudo de 6 de julho: o achado principal é novamente o <strong>espessamento das paredes das vias aéreas (broncopatia)</strong> — padrão de inflamação crônica das vias aéreas, e não algo agudo — e o contraste acrescenta tranquilidade onde mais importa: <strong>sem linfonodos aumentados, sem massas, cavidades pleurais livres e vasos pulmonares normais</strong>. Um detalhe novo: um <strong>micronódulo de 3 mm</strong> no lobo inferior esquerdo. Nódulos desse tamanho são achados incidentais muito comuns e em geral benignos; as diretrizes normalmente não exigem seguimento de rotina nesse tamanho em pacientes de baixo risco — seu médico pode simplesmente reavaliá-lo em um exame futuro. Observações repetidas: aterosclerose leve <strong>inclusive nas coronárias</strong> (a acompanhar na prevenção cardiovascular), alterações degenerativas da coluna e uma pequena hérnia diafragmática contendo gordura (achado comum e em geral inofensivo).</span>' +
            '</p>' +
            '<p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.5;">' +
              t('AI-generated plain-language summary of the radiologist&apos;s report — not a diagnosis. Read alongside the full report above.', 'Resumo em linguagem simples gerado por IA a partir do laudo do radiologista — não é um diagnóstico. Leia junto com o laudo completo acima.') +
            '</p>' +
          '</div>' +
        '</div>' +
      '</section>';

    // ── Chest X-ray (2 views) · 10 Jul 2026 (HURP, Ribeirão Preto) ──────
    // Same visit as the contrast CT (X-ray 18:32, CT 19:09). One way
    // (view = PA / lateral), each a count-1 stack (scrubber auto-hides).
    // Normal study. imaging_studies row scans/paulo-chest-xr-2026-07-10.
    var chestXr =
      '<section class="report-section" id="chest-xr-2026-07-10">' +
        '<div class="container">' +
          '<div class="section-label">' + t('3 · Imagery · Chest X-ray', '3 · Imagem · RX de tórax') + '</div>' +
          '<h2 class="section-title">' + t('Chest X-ray (2 views) · 10 July 2026', 'RX de tórax (2 incidências) · 10 de julho de 2026') + '</h2>' +
          '<p class="section-desc">' +
            t('Two-view chest radiograph — PA and lateral — taken at 18:32 on the same visit as the contrast CT above (19:09). Use the <strong>View</strong> buttons to switch incidence. The radiologist read the study as <strong>entirely normal</strong>; the full report follows below, with the original laudo available to download.',
              'Radiografia de tórax em duas incidências — PA e perfil — realizada às 18:32 na mesma visita da TC com contraste acima (19:09). Use os botões de <strong>Incidência</strong> para alternar. O radiologista interpretou o estudo como <strong>inteiramente normal</strong>; o laudo completo segue abaixo, com o original disponível para download.') +
          '</p>' +
          '<div class="report-export-row">' +
            '<a class="export-btn-primary" href="scans/paulo-chest-xr-2026-07-10/report.pdf?v=1" download>' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
              t('Export report (PDF)', 'Exportar laudo (PDF)') +
            '</a>' +
          '</div>' +
          '<div class="ct-grid ct-grid-single">' +
            '<div class="ct-viewer" data-prefix="scans/paulo-chest-xr-2026-07-10/" data-manifest="scans/paulo-chest-xr-2026-07-10/manifest.json?v=1">' +
              '<div class="ct-viewer-head">' +
                '<div class="ct-viewer-title">' + t('Radiograph viewer', 'Visualizador de radiografias') + '</div>' +
                '<div class="ct-viewer-meta">' + t('Image', 'Imagem') + ' <span class="ct-idx">1</span> / <span class="ct-total">1</span></div>' +
              '</div>' +
              '<div class="ct-controls"></div>' +
              '<div class="ct-stage"><img class="ct-img" alt="Chest X-ray image" loading="lazy"></div>' +
              '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="Chest X-ray image">' +
            '</div>' +
          '</div>' +
          '<h3 style="font-family:\'Raleway\',sans-serif;font-size:20px;font-weight:700;color:var(--blue-800);margin:2.5rem 0 0.75rem;">' +
            t('Radiologist&apos;s report', 'Laudo do radiologista') + ' <span class="mono" style="color:var(--text-muted);font-size:12px;font-weight:400;letter-spacing:0.06em;">' + t('(translated)', '(traduzido)') + '</span>' +
          '</h3>' +
          '<div class="two-col mb-3">' +
            '<div class="list-card">' +
              '<h4>' + t('Identifiers', 'Identificadores') + '</h4>' +
              '<ul>' +
                '<li><strong>' + t('Patient.', 'Paciente.') + '</strong> Paulo Augusto Silotto Dias de Souza</li>' +
                '<li><strong>' + t('DOB.', 'Nascimento.') + '</strong> ' + t('14 July 1961', '14 de julho de 1961') + '</li>' +
                '<li><strong>' + t('Exam date.', 'Data do exame.') + '</strong> ' + t('10 July 2026 · 18:32', '10 de julho de 2026 · 18:32') + '</li>' +
                '<li><strong>' + t('Exam.', 'Exame.') + '</strong> ' + t('Chest X-ray, 2 views (PA + lateral)', 'RX de tórax, 2 incidências (PA + perfil)') + '</li>' +
                '<li><strong>' + t('Accession.', 'Identificador.') + '</strong> 1056974 · ' + t('MRN', 'Prontuário') + ' 91619</li>' +
                '<li><strong>' + t('Requesting physician.', 'Médico solicitante.') + '</strong> Dr. Helton de Oliveira Couto</li>' +
                '<li><strong>' + t('Reporting physician.', 'Médico responsável.') + '</strong> Dr. Renato Campos Soares de Faria · CRM 82077</li>' +
                '<li><strong>' + t('Institution.', 'Instituição.') + '</strong> HURP · Hospital Unimed Ribeirão Preto · ' + t('Imaging Diagnostic Centre', 'Centro de Diagnóstico por Imagem') + '</li>' +
              '</ul>' +
            '</div>' +
            '<div class="list-card">' +
              '<h4>' + t('Findings', 'Achados') + '</h4>' +
              '<ul>' +
                '<li>' + t('Rib arches intact.', 'Arcos costais visualizados íntegros.') + '</li>' +
                '<li>' + t('Normal hila and pulmonary vasculature.', 'Hilos e trama vascular pulmonar normais.') + '</li>' +
                '<li>' + t('Mediastinum centered, no widening.', 'Mediastino centrado, sem evidências de alargamentos.') + '</li>' +
                '<li>' + t('Lung parenchyma without opacities, consolidations or nodules.', 'Parênquima pulmonar sem áreas de opacidades, consolidações ou nódulos.') + '</li>' +
                '<li>' + t('Free diaphragmatic domes and costophrenic angles.', 'Cúpulas e seios costofrênicos livres.') + '</li>' +
                '<li>' + t('Aorta of normal morphology, dimensions and topography.', 'Aorta de morfologia, dimensões e topografia normais.') + '</li>' +
                '<li>' + t('Cardiothoracic index within normal limits.', 'Área cardíaca mostrando índice cardiotorácico dentro da normalidade.') + '</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
          '<div class="alert alert-ok">' +
            '<strong>' + t('Impression:', 'Impressão diagnóstica:') + '</strong> ' +
            t(' <strong>Radiologically normal chest.</strong>', ' <strong>Tórax radiologicamente normal.</strong>') +
          '</div>' +
          '<div class="list-card ai-insight-card mb-3">' +
            '<h4><span class="ai-pill">' + t('AI summary', 'Resumo por IA') + '</span> ' + t('Plain-language read', 'Leitura em linguagem simples') + '</h4>' +
            '<p style="font-size:14px;color:var(--text-secondary);line-height:1.65;">' +
              '<span class="lang-en">A <strong>completely normal chest X-ray</strong> — lungs, heart size, mediastinum, diaphragm and ribs all read as unremarkable. Worth knowing: this was the first-line exam of the 10 July visit, followed forty minutes later by the contrast CT above. That the X-ray is normal while the CT shows bronchial wall thickening and a 3 mm micronodule is expected, not contradictory — plain radiographs simply cannot resolve findings that small; the CT is the more sensitive study of the pair. As a clean baseline radiograph it remains useful for comparison against any future chest films.</span>' +
              '<span class="lang-pt">Um <strong>RX de tórax completamente normal</strong> — pulmões, área cardíaca, mediastino, diafragma e costelas sem alterações. Vale saber: este foi o exame de primeira linha da visita de 10 de julho, seguido quarenta minutos depois pela TC com contraste acima. O RX normal ao lado da TC com espessamento brônquico e micronódulo de 3 mm é esperado, não contraditório — a radiografia simples não tem resolução para achados tão pequenos; a TC é o estudo mais sensível dos dois. Como radiografia de base limpa, segue útil para comparação com filmes futuros.</span>' +
            '</p>' +
            '<p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.5;">' +
              t('AI-generated plain-language summary of the radiologist&apos;s report — not a diagnosis. Read alongside the full report above.', 'Resumo em linguagem simples gerado por IA a partir do laudo do radiologista — não é um diagnóstico. Leia junto com o laudo completo acima.') +
            '</p>' +
          '</div>' +
        '</div>' +
      '</section>';

    // ── Chest CT · 6 Jul 2026 (Hospital São Luiz Campinas) ──────────────
    // Generic manifest-driven viewer (app.js auto-wires .ct-viewer): a single
    // "Series" way (dropdown) over the 6 diagnostic reconstructions. The dose
    // sheet (DICOM series 999) is intentionally excluded. Report follows the
    // house pattern: identifiers + radiologist findings/conclusion (PT/EN) + a
    // plain-language AI card + a download-original button (no inline PDF embed).
    var chestCt =
      '<section class="report-section" id="chest-ct-2026">' +
        '<div class="container">' +
          '<div class="section-label">' + t('4 · Imagery · Chest CT', '4 · Imagem · TC de tórax') + '</div>' +
          '<h2 class="section-title">' + t('Chest CT · 6 July 2026', 'TC de tórax · 6 de julho de 2026') + '</h2>' +
          '<p class="section-desc">' +
            t('Volumetric multidetector chest CT acquired in both inspiration and expiration, reconstructed six ways. Pick a reconstruction from the <strong>Series</strong> dropdown — lung parenchyma and mediastinal (soft-tissue) windows on the inspiration volume, the expiration acquisition and a high-resolution expiration series for air-trapping, plus thin axial and coronal reformats — then scrub the slider, scroll, drag, or use the arrow keys. The radiologist&apos;s findings and conclusion follow below, with a plain-language AI summary; the original laudo is available to download.',
              'TC de tórax volumétrica multidetectores adquirida em inspiração e expiração, reconstruída de seis formas. Escolha uma reconstrução no seletor <strong>Série</strong> — janelas de parênquima pulmonar e de mediastino (partes moles) sobre o volume de inspiração, a aquisição em expiração e uma série de alta resolução em expiração para aprisionamento aéreo, além das reformatações axial fina e coronal — e depois deslize o controle, role, arraste ou use as setas. Os achados e a conclusão do radiologista seguem abaixo, com um resumo em linguagem simples por IA; o laudo original está disponível para download.') +
          '</p>' +
          '<div class="report-export-row">' +
            '<a class="export-btn-primary" href="scans/paulo-chest-ct-2026-07-06-report.pdf?v=2" download>' +
              '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
              t('Export report (PDF)', 'Exportar laudo (PDF)') +
            '</a>' +
          '</div>' +
          '<div class="ct-grid ct-grid-single">' +
            '<div class="ct-viewer" data-prefix="scans/paulo-chest-ct-2026-07-06/" data-manifest="scans/paulo-chest-ct-2026-07-06/manifest.json?v=1">' +
              '<div class="ct-viewer-head">' +
                '<div class="ct-viewer-title">' + t('Series viewer', 'Visualizador por série') + '</div>' +
                '<div class="ct-viewer-meta">' + t('Image', 'Imagem') + ' <span class="ct-idx">1</span> / <span class="ct-total">1</span></div>' +
              '</div>' +
              '<div class="ct-controls"></div>' +
              '<div class="ct-stage"><img class="ct-img" alt="Chest CT image" loading="lazy"></div>' +
              '<input class="ct-slider" type="range" min="0" max="0" value="0" aria-label="Chest CT image">' +
            '</div>' +
          '</div>' +
          '<h3 style="font-family:\'Raleway\',sans-serif;font-size:20px;font-weight:700;color:var(--blue-800);margin:2.5rem 0 0.75rem;">' +
            t('Radiologist&apos;s report', 'Laudo do radiologista') + ' <span class="mono" style="color:var(--text-muted);font-size:12px;font-weight:400;letter-spacing:0.06em;">' + t('(translated)', '(traduzido)') + '</span>' +
          '</h3>' +
          '<div class="two-col mb-3">' +
            '<div class="list-card">' +
              '<h4>' + t('Identifiers', 'Identificadores') + '</h4>' +
              '<ul>' +
                '<li><strong>' + t('Patient.', 'Paciente.') + '</strong> Paulo Augusto Silotto Dias de Souza</li>' +
                '<li><strong>' + t('DOB.', 'Nascimento.') + '</strong> ' + t('14 July 1961', '14 de julho de 1961') + '</li>' +
                '<li><strong>' + t('Exam date.', 'Data do exame.') + '</strong> ' + t('6 July 2026 · 14:55', '6 de julho de 2026 · 14:55') + '</li>' +
                '<li><strong>' + t('Exam.', 'Exame.') + '</strong> ' + t('Chest CT (inspiration + expiration)', 'TC de tórax (inspiração + expiração)') + '</li>' +
                '<li><strong>' + t('Accession.', 'Identificador.') + '</strong> 9000000249014098 · ' + t('MRN', 'Prontuário') + ' 5493303</li>' +
                '<li><strong>' + t('Requesting physician.', 'Médico solicitante.') + '</strong> Dra. Tereza Cristina Goes Fernandez</li>' +
                '<li><strong>' + t('Institution.', 'Instituição.') + '</strong> Hospital São Luiz Campinas · Campinas · Rede D&apos;Or</li>' +
                '<li><strong>' + t('Scanner.', 'Equipamento.') + '</strong> GE Medical Systems · Revolution Maxima</li>' +
              '</ul>' +
            '</div>' +
            '<div class="list-card">' +
              '<h4>' + t('Technique', 'Técnica') + '</h4>' +
              '<ul>' +
                '<li>' + t('Helical multidetector CT.', 'TC helicoidal multidetectores.') + '</li>' +
                '<li>' + t('No iodinated intravenous contrast administered.', 'Sem administração de contraste iodado endovenoso.') + '</li>' +
                '<li>' + t('No prior exams available for comparison.', 'Exames anteriores não disponíveis para comparação.') + '</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
          '<div class="list-card mb-3">' +
            '<h4>' + t('Findings', 'Achados') + '</h4>' +
            '<ul>' +
              '<li><strong>' + t('Trachea &amp; bronchial tree.', 'Traqueia e árvore brônquica.') + '</strong> ' + t('Normal calibre, with <strong>diffuse bronchial wall thickening</strong>.', 'Calibres normais, com <strong>espessamento parietal brônquico difuso</strong>.') + '</li>' +
              '<li><strong>' + t('Lungs.', 'Pulmões.') + '</strong> ' + t('Preserved attenuation (normally aerated).', 'Atenuação preservada (normalmente aerados).') + '</li>' +
              '<li><strong>' + t('Pleural spaces.', 'Espaços pleurais.') + '</strong> ' + t('No pleural effusion; no pneumothorax.', 'Ausência de derrame pleural; sem pneumotórax.') + '</li>' +
              '<li><strong>' + t('Mediastinum.', 'Mediastino.') + '</strong> ' + t('No lymph-node enlargement; remaining mediastinal structures preserved.', 'Não se observam linfonodomegalias; demais estruturas mediastinais preservadas.') + '</li>' +
              '<li><strong>' + t('Cardiovascular.', 'Cardiovascular.') + '</strong> ' + t('Aorta and pulmonary trunk of preserved external calibre. Discrete <strong>diffuse atheromatosis, including coronary</strong>.', 'Aorta e tronco pulmonar com calibres externos preservados. Discreta <strong>ateromatose difusa, inclusive coronariana</strong>.') + '</li>' +
              '<li><strong>' + t('Cervicothoracic transition.', 'Transição cervicotorácica.') + '</strong> ' + t('Unremarkable.', 'Sem particularidades.') + '</li>' +
              '<li><strong>' + t('Soft tissues &amp; bone.', 'Partes moles e ossos.') + '</strong> ' + t('Dorsal (thoracic) spondylosis.', 'Espondilose dorsal.') + '</li>' +
              '<li><strong>' + t('Thoracoabdominal transition.', 'Transição toracoabdominal.') + '</strong> ' + t('Probable tiny renal cyst on the right.', 'Provável diminuto cisto renal à direita.') + '</li>' +
            '</ul>' +
          '</div>' +
          '<div class="alert alert-warn">' +
            '<strong>' + t('Conclusion:', 'Conclusão:') + '</strong> ' +
            t(' <strong>Inflammatory bronchopathy.</strong>', ' <strong>Broncopatia inflamatória.</strong>') +
          '</div>' +
          '<div class="list-card ai-insight-card mb-3">' +
            '<h4><span class="ai-pill">' + t('AI summary', 'Resumo por IA') + '</span> ' + t('Plain-language read', 'Leitura em linguagem simples') + '</h4>' +
            '<p style="font-size:14px;color:var(--text-secondary);line-height:1.65;">' +
              '<span class="lang-en">This non-contrast chest CT is largely reassuring. The <strong>lungs are normally aerated</strong> — no fluid, no collapse, no masses and no enlarged lymph nodes. The main finding is <strong>diffuse thickening of the bronchial (airway) walls</strong>, which the radiologist reads as <strong>inflammatory bronchopathy</strong> — a chronic airway-inflammation pattern (seen with chronic bronchitis, asthma, smoking or recurrent infection) rather than anything acute. Incidental notes: mild diffuse atherosclerosis <strong>including the coronary arteries</strong> (worth keeping in view for cardiovascular prevention), wear-and-tear change in the thoracic spine, and a probable tiny cyst on the right kidney (usually harmless). No earlier scans were available to compare; correlate the airway finding with symptoms and history.</span>' +
              '<span class="lang-pt">Esta TC de tórax sem contraste é, no geral, tranquilizadora. Os <strong>pulmões estão normalmente aerados</strong> — sem derrame, sem colapso, sem massas e sem linfonodos aumentados. O achado principal é o <strong>espessamento difuso das paredes brônquicas (vias aéreas)</strong>, que o radiologista interpreta como <strong>broncopatia inflamatória</strong> — um padrão de inflamação crônica das vias aéreas (visto em bronquite crônica, asma, tabagismo ou infecções de repetição), e não algo agudo. Achados incidentais: aterosclerose difusa leve <strong>inclusive nas coronárias</strong> (a acompanhar na prevenção cardiovascular), alterações degenerativas da coluna torácica e um provável diminuto cisto no rim direito (em geral benigno). Não havia exames anteriores para comparação; correlacionar o achado das vias aéreas com sintomas e história clínica.</span>' +
            '</p>' +
            '<p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;line-height:1.5;">' +
              t('AI-generated plain-language summary of the radiologist&apos;s report — not a diagnosis. Read alongside the full report above.', 'Resumo em linguagem simples gerado por IA a partir do laudo do radiologista — não é um diagnóstico. Leia junto com o laudo completo acima.') +
            '</p>' +
          '</div>' +
        '</div>' +
      '</section>';

    var history      = buildPauloHistorySection();
    var otherStudies = buildPauloOtherStudiesSection();
    var overall      = buildPauloOverallEvolution();
    var labs         = renderPauloLabsSection();
    var ergometric   = renderPauloErgoSection();
    var sleep        = renderPauloSleepSection();

    // ── 11 · Cardiac · ECG — DB-driven, shared ecg_studies pipeline ──────
    // Same mechanism as the static physical-exams page: the mount below is
    // filled at runtime by decorateEcgStudies() from /api/patient-exams,
    // hydrating the Lumen SVG inline with the date pill + version switcher.
    // Scoped IDs (paulo-*) so we never collide with the static shell's hidden
    // #ecg-mount, which hidePageBody() leaves present-but-hidden in the DOM.
    // Hidden until >=1 study exists (decorate reveals it).
    var ecg =
      '<section class="report-section" id="paulo-ecg-section" style="display:none;">' +
        '<div class="container">' +
          '<div class="section-label">' + t('11 · Cardiac · ECG', '11 · Cardíaco · ECG') + '</div>' +
          '<p class="section-desc">' +
            t('Resting 12-lead ECG recorded during the 10 July 2026 hospital stay at HURP. The tracing below is the source printout framed for the dashboard — a visual rendering, not a diagnostic instrument — and the device’s automated reading was not physician-confirmed. The date pill switches between ECGs as more are added.',
              'ECG de repouso de 12 derivações registrado durante a internação de 10 de julho de 2026 no HURP. O traçado abaixo é a impressão original emoldurada para o painel — uma representação visual, não um instrumento diagnóstico — e a leitura automática do aparelho não foi confirmada por médico. A pílula de data alterna entre ECGs à medida que forem adicionados.') +
          '</p>' +
          '<div id="paulo-ecg-mount"></div>' +
        '</div>' +
      '</section>';

    var main = document.createElement('div');
    main.className = 'jc-paulo-exams';
    // Imagery exams render newest-first (house rule): contrast chest CT
    // (10 Jul 19:09) -> chest X-ray (10 Jul 18:32) -> non-contrast chest CT
    // (6 Jul) -> spine MRI (15 May). Cardiac cluster: ergometric (10) then ECG (11).
    main.innerHTML = aiSummary + chestCtContrast + chestXr + chestCt + imagery + history + otherStudies + overall +
      labs + ergometric + ecg + sleep;

    return {
      el: main,
      after: function () {
        // Wire the unified viewer (handles both anatomies + orientations)
        var unifiedViewer = main.querySelector('.pl-ct-viewer[data-paulo-study="spine-combined"]');
        if (unifiedViewer) wirePauloUnifiedViewer(unifiedViewer, PAULO_STUDIES);
        // Wire the generic .ct-viewer(s) injected above (chest CT · manifest-
        // driven). The spine viewer is bespoke (.pl-ct-viewer); the chest CT
        // uses app.js's generic engine, which only auto-runs at load — so
        // re-scan after injection.
        if (typeof window !== 'undefined' && window.JCInitCtViewers) window.JCInitCtViewers();
        // DB-driven ECG block — scoped to Paulo's subtree + IDs so the static
        // shell's hidden #ecg-mount is never touched.
        decorateEcgStudies(PAULO_SILOTTO, { root: main, sectionSel: '#paulo-ecg-section', mountSel: '#paulo-ecg-mount' });
      },
    };
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
      '.jc-silvana-exams { background: var(--surface-base, #F9F7F4); padding: 0 0 96px; }',
      '.jc-silvana-exams .hero { background: #0D1B2A; color: #FFFFFF; padding: 48px 0 56px; }',
      '.jc-silvana-exams .hero .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-silvana-exams .hero-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 10px; }',
      '.jc-silvana-exams .hero-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; line-height: 1.15; color: #FFFFFF; margin: 0 0 12px; }',
      '.jc-silvana-exams .hero-sub { color: rgba(255,255,255,0.78); font-size: 15px; line-height: 1.6; margin: 0 0 18px; max-width: 72ch; }',
      '.jc-silvana-exams .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; margin-top: 8px; }',
      '.jc-silvana-exams .hero-meta-item { display: flex; flex-direction: column; gap: 2px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: rgba(255,255,255,0.55); letter-spacing: 0.06em; text-transform: uppercase; }',
      '.jc-silvana-exams .hero-meta-item > span:last-child { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 400; color: #FFFFFF; text-transform: none; letter-spacing: 0; }',
      '.jc-silvana-exams #silv-content { padding: 36px 0 16px; }',
      '.jc-silvana-exams #silv-content > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',

      // AI summary card
      '.jc-silvana-exams .silv-ai-summary { background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #B8954A; border-radius: 10px; padding: 22px 26px; margin-bottom: 24px; }',
      '.jc-silvana-exams .silv-ai-summary-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }',
      '.jc-silvana-exams .silv-ai-summary-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0; }',
      '.jc-silvana-exams .silv-ai-summary-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 14px; }',
      '.jc-silvana-exams .silv-ai-summary-body { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; line-height: 1.65; color: #1E2D3D; }',
      '.jc-silvana-exams .silv-ai-summary-body p { margin: 0 0 10px; }',
      '.jc-silvana-exams .silv-ai-summary-body p:last-child { margin-bottom: 0; }',
      '.jc-silvana-exams .silv-ai-summary-body strong { color: #0D1B2A; }',

      // Three big insights (Physical / Mental / Spiritual)
      '.jc-silvana-exams .silv-insights { margin-top: 22px; padding-top: 18px; border-top: 1px solid #E5E2DC; }',
      '.jc-silvana-exams .silv-insights-heading { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0 0 14px; }',
      '.jc-silvana-exams .silv-insights-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }',
      '@media (max-width: 880px) { .jc-silvana-exams .silv-insights-grid { grid-template-columns: 1fr; } }',
      '.jc-silvana-exams .silv-insight { background: #F9F7F4; border: 1px solid #E5E2DC; border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }',
      '.jc-silvana-exams .silv-insight-physical  { border-top: 3px solid #244E6E; }',
      '.jc-silvana-exams .silv-insight-mental    { border-top: 3px solid #B8954A; }',
      '.jc-silvana-exams .silv-insight-spiritual { border-top: 3px solid #7A8FA6; }',
      '.jc-silvana-exams .silv-insight-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; }',
      '.jc-silvana-exams .silv-insight-headline { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; line-height: 1.3; color: #0D1B2A; }',
      '.jc-silvana-exams .silv-insight-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      '.jc-silvana-exams .silv-insight-body p { margin: 0 0 8px; }',
      '.jc-silvana-exams .silv-insight-body p:last-child { margin-bottom: 0; }',
      '.jc-silvana-exams .silv-insight-body strong { color: #0D1B2A; }',
      '.jc-silvana-exams .silv-insight-tbd .silv-insight-headline { color: #7A8FA6; font-weight: 300; font-size: 22px; letter-spacing: 0.04em; }',
      '.jc-silvana-exams .silv-insight-tbd .silv-insight-body { color: #7A8FA6; font-style: italic; }',

      // Per-marker history table
      '.jc-silvana-exams .silv-hist { margin-top: 10px; }',
      '.jc-silvana-exams .silv-hist summary { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.04em; color: #244E6E; cursor: pointer; padding: 6px 8px; background: #F4F1EA; border: 1px solid #E5E2DC; border-radius: 6px; list-style: none; }',
      '.jc-silvana-exams .silv-hist summary::-webkit-details-marker { display: none; }',
      '.jc-silvana-exams .silv-hist summary::before { content: "▸"; display: inline-block; width: 12px; margin-right: 4px; transition: transform 0.15s; }',
      '.jc-silvana-exams .silv-hist[open] summary::before { transform: rotate(90deg); }',
      '.jc-silvana-exams .silv-hist-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      '.jc-silvana-exams .silv-hist-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 6px 8px; border-bottom: 1px solid #E5E2DC; }',
      '.jc-silvana-exams .silv-hist-table td { padding: 6px 8px; border-bottom: 1px solid #EFEBE3; vertical-align: top; color: #1E2D3D; }',
      '.jc-silvana-exams .silv-hist-row-latest td { background: rgba(184, 149, 74, 0.06); font-weight: 500; }',
      '.jc-silvana-exams .silv-hist-row-flag .silv-hist-val { color: #7A2E22; }',
      '.jc-silvana-exams .silv-hist-date { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; white-space: nowrap; }',
      '.jc-silvana-exams .silv-hist-val { font-family: "IBM Plex Mono", monospace; }',
      '.jc-silvana-exams .silv-hist-note { font-size: 11px; color: #7A8FA6; }',
      '.jc-silvana-exams .silv-latest-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',

      // Historical comparison table cell coloring
      '.jc-silvana-exams .lab-cmp-val[data-flag="high"] { color: #7A2E22; }',
      '.jc-silvana-exams .lab-cmp-val[data-flag="low"]  { color: #B8862B; }',

      // Source PDF list
      '.jc-silvana-exams .silv-docs { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }',
      '.jc-silvana-exams .silv-doc-link { display: block; padding: 12px 14px; border: 1px solid #E5E2DC; border-radius: 8px; background: #FFFFFF; color: #0D1B2A; text-decoration: none; transition: border-color 0.12s, transform 0.06s; }',
      '.jc-silvana-exams .silv-doc-link:hover { border-color: #B8954A; transform: translateY(-1px); }',
      '.jc-silvana-exams .silv-doc-title { display: block; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; font-weight: 500; margin-bottom: 4px; }',
      '.jc-silvana-exams .silv-doc-meta { display: block; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',

      // Imaging & diagnostic studies
      '.jc-silvana-exams .silv-studies { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }',
      '.jc-silvana-exams .silv-study { background: #FFFFFF; border: 1px solid #E5E2DC; border-left: 4px solid #7A8FA6; border-radius: 10px; padding: 16px 18px; }',
      '.jc-silvana-exams .silv-study-imaging    { border-left-color: #244E6E; }',
      '.jc-silvana-exams .silv-study-pathology  { border-left-color: #7A2E22; }',
      '.jc-silvana-exams .silv-study-endoscopy  { border-left-color: #B8954A; }',
      '.jc-silvana-exams .silv-study-functional { border-left-color: #3E7CA3; }',
      '.jc-silvana-exams .silv-study-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }',
      '.jc-silvana-exams .silv-study-cat { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: #EEF1F4; color: #566; }',
      '.jc-silvana-exams .silv-study-cat-imaging    { background: #E7EEF5; color: #244E6E; }',
      '.jc-silvana-exams .silv-study-cat-pathology  { background: #F4E7E3; color: #7A2E22; }',
      '.jc-silvana-exams .silv-study-cat-endoscopy  { background: #F7F0DD; color: #8a6d23; }',
      '.jc-silvana-exams .silv-study-cat-functional { background: #E8F0F4; color: #2c6080; }',
      '.jc-silvana-exams .silv-study-date { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; }',
      '.jc-silvana-exams .silv-study-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; line-height: 1.25; color: #0D1B2A; margin-bottom: 5px; }',
      '.jc-silvana-exams .silv-study-meta { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; margin-bottom: 9px; line-height: 1.5; }',
      '.jc-silvana-exams .silv-study-concl { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.55; color: #1E2D3D; margin: 0 0 10px; }',
      '.jc-silvana-exams .silv-study-srcs { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.jc-silvana-exams .silv-study-src { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #244E6E; text-decoration: none; border: 1px solid #E5E2DC; border-radius: 6px; padding: 4px 10px; background: #F4F1EA; }',
      '.jc-silvana-exams .silv-study-src:hover { border-color: #B8954A; }',

      // Grouped sections (Imaging / Endoscopy / Pathology / Functional) + amber AI card
      '.jc-silvana-exams .silv-study-group { margin-bottom: 30px; }',
      '.jc-silvana-exams .silv-study-group-head { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 17px; color: #0D1B2A; margin: 20px 0 12px; display: flex; align-items: center; gap: 9px; }',
      '.jc-silvana-exams .silv-study-group-count { font-family: "IBM Plex Mono", monospace; font-size: 12px; font-weight: 500; color: #7A8FA6; background: #EEF1F4; border-radius: 999px; padding: 1px 9px; }',
      // amber background + stroke come from the shared .ai-insight-card token rule in styles.css
      '.jc-silvana-exams .silv-study-ai { border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }',
      '.jc-silvana-exams .silv-study-ai-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }',
      '.jc-silvana-exams .silv-study-ai-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; color: #0D1B2A; }',
      '.jc-silvana-exams .silv-study-ai-body { font-family: "IBM Plex Sans", sans-serif; font-size: 13px; line-height: 1.6; color: #1E2D3D; }',
      '.jc-silvana-exams .silv-study-ai-body p { margin: 0; }',
      '.jc-silvana-exams .silv-study-ai-body strong { color: #0D1B2A; }',
      '.jc-silvana-exams .silv-study-ai-disc { font-size: 11px; font-style: italic; color: #8a6d23; margin: 8px 0 0; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* Physical → overview landing for Silvana. Two entry cards, modeled
     on Joao's physical.html: Sinais Vitais and Exames. Genetics is
     intentionally out for now — no data uploaded yet. */
  /* Silvana's physical landing (assembler provider): the 2-card hub only —
     hero/tail/footer are assembler-owned. */
  function renderSilvanaPhysicalLanding() {
    injectSilvanaStyles();
    injectSilvanaLandingStyles();

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

    var main = document.createElement('div');
    main.className = 'jc-silvana-exams jc-silvana-landing';
    main.innerHTML = cards;
    return main;
  }

  function injectSilvanaLandingStyles() {
    if (document.getElementById('silvana-landing-styles')) return;
    var s = document.createElement('style');
    s.id = 'silvana-landing-styles';
    s.textContent = [
      '.jc-silvana-landing .silv-landing { padding: 36px 0 24px; }',
      '.jc-silvana-landing .silv-landing > .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }',
      '.jc-silvana-landing .silv-landing-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }',
      '@media (max-width: 880px) { .jc-silvana-landing .silv-landing-grid { grid-template-columns: 1fr; } }',
      '.jc-silvana-landing .silv-landing-card { display: flex; flex-direction: column; gap: 12px; padding: 22px 24px; background: #FFFFFF; border: 1px solid #E5E2DC; border-top: 3px solid #244E6E; border-radius: 10px; text-decoration: none; color: inherit; transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s; }',
      '.jc-silvana-landing .silv-landing-card:hover { transform: translateY(-2px); border-color: #B8954A; box-shadow: 0 6px 18px rgba(13,27,42,0.08); }',
      '.jc-silvana-landing .silv-landing-icon { width: 56px; height: 56px; }',
      '.jc-silvana-landing .silv-landing-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 18px; color: #0D1B2A; }',
      '.jc-silvana-landing .silv-landing-status { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.jc-silvana-landing .silv-landing-bullets { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; color: #1E2D3D; line-height: 1.45; }',
      '.jc-silvana-landing .silv-landing-bullets li { position: relative; padding-left: 14px; }',
      '.jc-silvana-landing .silv-landing-bullets li::before { content: "·"; position: absolute; left: 4px; color: #B8954A; font-weight: 700; }',
      '.jc-silvana-landing .silv-landing-cta { margin-top: auto; font-family: "IBM Plex Mono", monospace; font-size: 12px; color: #244E6E; letter-spacing: 0.04em; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function renderSilvanaPhysicalExams() {
    if (!window.SILVANA_LABS) {
      console.error('SILVANA_LABS data not loaded — expected via assets/silvana-labs.js');
      return null; // assembler renders the honest empty state
    }
    injectSilvanaStyles();

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
          // Medications & Supplements — DB-driven (/api/patient-summary), filled
          // async below so it docks directly under the AI summary card.
          '<div id="silv-meds-mount"></div>' +
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

    var main = document.createElement('div');
    main.className = 'jc-silvana-exams';
    main.innerHTML = imagery;

    // Medications & Supplements: this page is hand-curated from SILVANA_LABS and
    // has no summary object, so pull meds/supps from the DB (/api/patient-summary)
    // and dock them under the AI summary card. Silent no-op if she has none or the
    // call fails — never blocks the lab render above.
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (summary) {
        var mount = main.querySelector('#silv-meds-mount');
        if (!mount || !summary) return;
        var inner = medsTablesInner(summary);
        if (!inner) return;
        mount.innerHTML =
          '<div class="section-label" style="margin-top:32px;">' +
            '<span class="lang-en">Treatment</span><span class="lang-pt">Tratamento</span>' +
          '</div>' +
          '<h2 class="section-title">' +
            '<span class="lang-en">Medications &amp; Supplements</span>' +
            '<span class="lang-pt">Medicações e Suplementos</span>' +
          '</h2>' +
          '<p class="section-desc">' +
            '<span class="lang-en">Current regimen on file. Daily dose is computed (strength × units per dose × doses per day); informational, not a prescription.</span>' +
            '<span class="lang-pt">Regime atual em registro. A dose diária é calculada (concentração × unidades por tomada × tomadas por dia); informativo, não é uma prescrição.</span>' +
          '</p>' +
          inner;
      })
      .catch(function () { /* meds are additive — never break the labs page */ });

    return main;
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
      return null; // assembler renders the honest empty state
    }
    injectSilvanaStyles();

    var data = window.CRISTINA_LABS;
    var nMarkers = data.panels.reduce(function (acc, pn) { return acc + pn.markers.length; }, 0);
    var nStudies = (data.studies || []).length;
    var doc = (data.documents && data.documents[0]) || {};
    var examDate = doc.date || '2026-03-11';



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

    var main = document.createElement('div');
    main.className = 'jc-silvana-exams jc-cristina-exams';
    main.innerHTML = content;
    return main;
  }

  /* ── Silvana Creste · bespoke Physical → Vitals view ─────────────
     Body composition from a single InBody120 panel (11 Feb 2026) plus
     one prior baseline (18 Nov 2025) for the history chart. Hand-curated
     because the InBody printout is an image, not structured data — the
     extractor would mangle it. Latest values rendered as .lab-test
     cards with the same range bars used everywhere else; segmental
     analysis rendered as two SVG silhouettes with overlaid badges.

     The data itself lives in assets/silvana-vitals.js (window.SILVANA_INBODY),
     a GATED_ASSETS file served only with the `vitals` scope on Silvana —
     it must NOT be inlined here (this file is public). renderSilvanaVitals
     fails closed when the global is absent.                              */


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
          /* Narrative + DOB ship inside the gated silvana-vitals.js (PHI). */
          '<p class="hero-sub">' + (data.hero_sub_html || '') + '</p>' +
          '<div class="hero-meta">' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Patient', 'Paciente') + '</span><span>Silvana Creste</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('DOB · age', 'Nasc. · idade') + '</span>' +
              '<span>' + (data.dob_html || '') + '</span>' +
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
      '.jc-silvana-vitals .silv-vitals-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }',
      '.jc-silvana-vitals .silv-vitals-pair > .lab-panel { margin-bottom: 0 !important; }',
      '@media (max-width: 880px) { .jc-silvana-vitals .silv-vitals-pair { grid-template-columns: 1fr; } }',

      // Segmental analysis grid — two figures side by side
      '.jc-silvana-vitals .silv-segmental-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }',
      '@media (max-width: 880px) { .jc-silvana-vitals .silv-segmental-grid { grid-template-columns: 1fr; } }',
      '.jc-silvana-vitals .silv-segmental { display: flex; flex-direction: column; align-items: center; }',
      '.jc-silvana-vitals .silv-segmental-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; color: #244E6E; margin: 0 0 8px; text-align: center; }',
      '.jc-silvana-vitals .silv-figure-wrap { position: relative; width: 100%; max-width: 360px; aspect-ratio: 220 / 380; }',
      '.jc-silvana-vitals .silv-fig { position: absolute; inset: 0; width: 100%; height: 100%; }',
      '.jc-silvana-vitals .silv-fig-label { position: absolute; min-width: 72px; padding: 4px 8px; background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 6px; font-family: "IBM Plex Mono", monospace; line-height: 1.35; text-align: center; box-shadow: 0 1px 3px rgba(13,27,42,0.06); }',
      '.jc-silvana-vitals .silv-fig-val { font-family: "IBM Plex Sans", sans-serif; font-size: 12px; font-weight: 600; color: #0D1B2A; }',
      '.jc-silvana-vitals .silv-fig-pct { font-size: 10px; color: #7A8FA6; margin: 1px 0 3px; }',
      '.jc-silvana-vitals .silv-fig-status { display: inline-block; padding: 1px 6px; border-radius: 4px; font-family: "IBM Plex Sans", sans-serif; font-size: 9px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }',
      '.jc-silvana-vitals .silv-fig-status-normal { background: #E6F4EA; color: #2D5F3F; border: 1px solid #85B595; }',
      '.jc-silvana-vitals .silv-fig-status-flag   { background: #FBE9E7; color: #7A2E22; border: 1px solid #E5B5AB; }',
      // Label positions relative to wrapper
      '.jc-silvana-vitals .silv-fig-label-left-arm  { top: 22%; left: -4px; }',
      '.jc-silvana-vitals .silv-fig-label-right-arm { top: 22%; right: -4px; }',
      '.jc-silvana-vitals .silv-fig-label-trunk     { top: 44%; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,0.92); }',
      '.jc-silvana-vitals .silv-fig-label-left-leg  { top: 72%; left: -4px; }',
      '.jc-silvana-vitals .silv-fig-label-right-leg { top: 72%; right: -4px; }',

      // History panel — three sparkline charts in a row
      '.jc-silvana-vitals .silv-history-charts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 14px; }',
      '@media (max-width: 880px) { .jc-silvana-vitals .silv-history-charts { grid-template-columns: 1fr; } }',
      '.jc-silvana-vitals .silv-history-chart { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 8px; padding: 12px 14px; }',
      '.jc-silvana-vitals .silv-history-chart-title { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 12px; letter-spacing: 0.04em; color: #244E6E; margin-bottom: 4px; }',
      '.jc-silvana-vitals .silv-history-chart-title small { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; font-weight: 400; }',

      // Delta table
      '.jc-silvana-vitals .silv-history-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-family: "IBM Plex Sans", sans-serif; font-size: 12px; }',
      '.jc-silvana-vitals .silv-history-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 6px 8px; border-bottom: 1px solid #E5E2DC; }',
      '.jc-silvana-vitals .silv-history-table td { padding: 6px 8px; border-bottom: 1px solid #EFEBE3; vertical-align: middle; color: #1E2D3D; font-family: "IBM Plex Mono", monospace; }',
      '.jc-silvana-vitals .silv-history-table .silv-hist-cmp-marker { font-family: "IBM Plex Sans", sans-serif; color: #0D1B2A; font-weight: 500; }',
      '.jc-silvana-vitals .silv-history-table .silv-hist-cmp-delta { font-weight: 600; color: #244E6E; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function silvanaVitalsAiSummary() {
    // Narrative HTML ships inside the gated silvana-vitals.js (PHI values
    // + 7-year lab context must not live in this public file).
    var d = window.SILVANA_INBODY;
    return (d && d.ai_summary_html) || '';
  }

  function renderSilvanaVitals() {
    /* Fail closed: the data asset is scope-gated (vitals on Silvana); a
       viewer without the scope gets a 403 and no global — render nothing. */
    var data = window.SILVANA_INBODY;
    if (!data) return null;
    injectSilvanaStyles();
    injectSilvanaVitalsStyles();

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

    var main = document.createElement('div');
    main.className = 'jc-silvana-exams jc-silvana-vitals';
    main.innerHTML = content;
    return main;
  }
})();

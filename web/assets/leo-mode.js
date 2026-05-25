/* JC Advisory — leo-mode.js
 *
 * Leo Keller is a demo patient that inherits Patient Zero's clinical
 * data (labs, vitals, imaging) but with different demographics and a
 * radically different medication profile (Perindopril only). Rather
 * than duplicate every static HTML page, this script runs as a
 * DOM-level transformer on every static page when the active patient
 * is Leo:
 *
 *   1. Force English locale (Leo's native_language is 'en').
 *   2. Swap demographic strings in text nodes:
 *        Joao / João → Leo
 *        Joao Victor Creste → Leo Keller
 *        17 October 1992 → 17 July 1990
 *        age 33 → age 35
 *        London → Paris  (GB → FR)
 *   3. Hide blocks the user removed:
 *        #meds          (physical.html medication + supplements)
 *        #assessment    (physical-vitals.html osteopath letter)
 *        [data-leo-hide="medications"]  (mental.html regimen + table + boundary)
 *        [data-leo-hide="med-history"]  (mental.html medication history card)
 *   4. Hide Joao-medication-specific AI narrative:
 *        .lab-causes-list and .lab-note (all keyed to Cymbalta/Lyrica/
 *         Depakote etc — not applicable to Leo on Perindopril).
 *        The personalised letter in assessment.html (intensely Joao).
 *   5. Inject a Leo-specific "Current medications" card on home and
 *      physical pages — Perindopril 4 mg/day for blood pressure.
 *   6. Inject a Leo-specific "AI summary" card on home — Perindopril
 *      context + lab-pattern recap.
 *
 * Idempotent: re-running has no effect.
 */
(function () {
  'use strict';

  var LEO_CLERK = 'pending:leo-keller-a3f1c2';

  // Detect the active patient. Mirrors patient-context.js resolution.
  var params = new URLSearchParams(location.search);
  var fromUrl = params.get('patient');
  var stored = sessionStorage.getItem('jc_current_patient');
  var patient = fromUrl || stored;
  if (patient !== LEO_CLERK) return;

  // Force English locale — overrides any html[lang="pt"] persisted state.
  document.documentElement.setAttribute('lang', 'en');

  // ─── 1. Demographic text replacements ───────────────────────────
  // Operate on text nodes only so we don't touch markup or attrs.
  var REPLACEMENTS = [
    // Names — order matters: longer first so we don't half-replace.
    [/Joao Victor Creste Dias de Souza/g, 'Leo Keller'],
    [/João Victor Creste Dias de Souza/g, 'Leo Keller'],
    [/Joao Victor Creste/g, 'Leo Keller'],
    [/João Victor Creste/g, 'Leo Keller'],
    [/\bJoao Creste\b/g, 'Leo Keller'],
    [/\bJoão Creste\b/g, 'Leo Keller'],
    [/\bJoao\b/g, 'Leo'],
    [/\bJoão\b/g, 'Leo'],

    // DOB / age — Joao 17 Oct 1992 (DB shows 1992-10-16 due to UTC) → Leo 17 Jul 1990
    [/17 October 1992/g, '17 July 1990'],
    [/16 October 1992/g, '17 July 1990'],
    [/17 Oct 1992/g, '17 Jul 1990'],
    [/16 Oct 1992/g, '17 Jul 1990'],
    [/17 outubro 1992/g, '17 julho 1990'],
    [/16 outubro 1992/g, '17 julho 1990'],
    [/17\/10\/1992/g, '17/07/1990'],
    [/16\/10\/1992/g, '17/07/1990'],
    // Age — only swap in obvious age contexts to avoid touching "33" used elsewhere.
    [/\b33 years old\b/g, '35 years old'],
    [/\bage 33\b/g, 'age 35'],
    [/\b33 yrs\b/g, '35 yrs'],
    [/\bage:\s*33\b/gi, 'age: 35'],
    [/\(33\)/g, '(35)'],
    [/· 33 ·/g, '· 35 ·'],          // "Leo Keller · 33 · Paris" header pattern
    [/· 33 anos/g, '· 35 anos'],    // pt counterpart
    [/, 33,/g, ', 35,'],
    [/Leo, 33/g, 'Leo, 35'],
    [/age 33\b/g, 'age 35'],
    [/aged 33\b/g, 'aged 35'],
    [/, age 33/g, ', age 35'],

    // Residence — Joao lives in London (GB); Leo in Paris (FR).
    [/\bLondon\b/g, 'Paris'],
    [/\bLondres\b/g, 'Paris'],
    // GB → FR only on word boundaries where it's clearly the country code.
    // We don't touch arbitrary GB/FR text since the static pages use
    // "GB" in only a few demographic contexts.
  ];

  function walkText(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      var changed = false;
      for (var i = 0; i < REPLACEMENTS.length; i++) {
        var pair = REPLACEMENTS[i];
        if (pair[0].test(t)) {
          // Reset regex.lastIndex for global patterns
          pair[0].lastIndex = 0;
          t = t.replace(pair[0], pair[1]);
          changed = true;
        }
      }
      if (changed) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1) return;
    // Skip script/style — leave their content alone.
    var tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    for (var c = node.firstChild; c; c = c.nextSibling) walkText(c);
  }

  // ─── 2. Hide blocks ─────────────────────────────────────────────
  var HIDE_SELECTORS = [
    '#meds',                           // physical.html: medication + supplementation section
    '#assessment',                     // physical-vitals.html: osteopath assessment
    '[data-leo-hide]',                 // mental.html: regimen + medication history
    '.lab-causes-list',                // physical-exams.html: medication-driven causes lists
    '.lab-causes',                     // physical-exams.html: wrapper around causes lists (incl. titles)
    '.lab-note',                       // physical-exams.html: per-marker AI notes (Joao-specific)
    '.letter-content',                 // assessment.html: the long personalised letter (if class exists)
    '.ct-grid',                        // physical-exams.html: every image viewer grid in #imagery
  ];

  function hideSelectors() {
    HIDE_SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) { el.style.display = 'none'; });
      } catch (_) {}
    });
  }

  // Patient-supplied forehead photo gallery (physical-exams.html).
  // Targeted by the "Patient notes" heading + "(patient-supplied
  // photographs)" subtitle — no stable CSS hook so we walk siblings
  // from the heading until the next major heading / section.
  function hidePatientPhotos() {
    document.querySelectorAll('h3').forEach(function (h3) {
      var t = h3.textContent || '';
      if (t.indexOf('Patient notes') === -1 && t.indexOf('Anotações do paciente') === -1) return;
      if (t.indexOf('patient-supplied') === -1 && t.indexOf('fotografias') === -1 && t.indexOf('Fotografias') === -1) return;
      h3.style.display = 'none';
      var sib = h3.nextElementSibling;
      while (sib) {
        var next = sib.nextElementSibling;
        var tag = sib.tagName;
        if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'SECTION') break;
        sib.style.display = 'none';
        sib = next;
      }
    });
  }

  // Joao-specific AI-insight callouts (lock pre-text-replacement, since
  // walkText would have already swapped "Joao" → "Leo"). These callouts
  // synthesise Joao's medication-driven story (Cymbalta taper, Lyrica
  // step-up, Depakote add, Diprospan injection, benzodiazepine
  // dependency). None of that applies to Leo.
  function hideJoaoSpecificAlerts() {
    var triggerWords = [
      'Depakote', 'Cymbalta', 'duloxetine', 'Duloxetine', 'Lyrica',
      'pregabalin', 'pregabalina', 'Pregabalin', 'Pregabalina',
      'Diprospan', 'Diazepam', 'diazepam', 'benzodiazepine',
      'benzodiazepínico', 'Quetiapine', 'Quetros', 'Valium',
      'alprazolam', 'Alprazolam', 'Dr. Tisher', 'Dr. Eduardo Tisher',
      'taper trajectory', 'medication regimen', 'AUDIT',
      'overdose', 'OD episode', 'self-poisoning',
    ];
    var hideAlertSelectors = [
      '.alert', '.alert-flag', '.alert-info', '.alert-watch', '.alert-warn',
    ];
    var seen = new Set();
    hideAlertSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (seen.has(el)) return;
        var t = el.textContent || '';
        for (var i = 0; i < triggerWords.length; i++) {
          if (t.indexOf(triggerWords[i]) !== -1) {
            el.style.display = 'none';
            seen.add(el);
            break;
          }
        }
      });
    });

    // Same logic for AI-narrative summary blocks on physical.html
    // ("Three signals converging" + similar) — they synthesise Joao's
    // April 2026 deterioration arc and reference his meds.
    document.querySelectorAll('section, [class*="callout"], [class*="summary"]').forEach(function (el) {
      var t = el.textContent || '';
      if (
        (t.includes('Depakote') || t.includes('Lyrica') || t.includes('Cymbalta')) &&
        (t.includes('Three signals') || t.includes('Likely contributors') || t.includes('deterioration') ||
         t.includes('crisis') && t.includes('29 April'))
      ) {
        // Only hide the immediate alert/callout, not the entire section
        el.querySelectorAll('.alert, .alert-flag, .alert-info').forEach(function (a) {
          a.style.display = 'none';
        });
      }
    });
  }

  // ─── 3. Strip nav links that don't apply to Leo's reduced view ──
  // (Leo has no medications nav target on physical, no osteopath
  // sub-target on vitals — keep the section-nav clean.)
  function stripNavLinks() {
    var hideHashes = ['#meds', '#assessment'];
    document.querySelectorAll('.section-nav a, .topnav-links a, nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (hideHashes.indexOf(href) !== -1) a.style.display = 'none';
    });
  }

  // ─── 4. Inject "Current medications" card ───────────────────────
  function injectPerindoprilCard() {
    if (document.getElementById('leo-perindopril-card')) return;

    var card = document.createElement('section');
    card.id = 'leo-perindopril-card';
    card.className = 'report-section';
    card.innerHTML =
      '<div class="container">' +
        '<div class="section-label">02 · Pharmacology</div>' +
        '<h2 class="section-title">Current medications</h2>' +
        '<p class="section-desc">' +
          'A single antihypertensive on the current regimen — no other prescriptions, no supplementation regime on file.' +
        '</p>' +
        '<table class="data-table">' +
          '<thead><tr>' +
            '<th>Medication</th><th>Dose</th><th>Class</th><th>Indication</th><th>Status</th>' +
          '</tr></thead>' +
          '<tbody>' +
            '<tr>' +
              '<td class="strong">Perindopril</td>' +
              '<td class="num">4 mg/day</td>' +
              '<td>ACE inhibitor</td>' +
              '<td>Blood pressure</td>' +
              '<td><span class="pill pill-ok">Active</span></td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';

    // Drop the card only where the medications section used to live —
    // physical.html has an anchor `#clinical` right after the (now
    // hidden) #meds section. On every other page (home / mental /
    // exams / etc.) the card simply isn't shown: medications already
    // appear in the home AI summary risk list ("Blood pressure ...
    // Perindopril 4 mg/day is the single agent on board") and we
    // don't need to repeat them.
    var clinical = document.getElementById('clinical');
    if (clinical && clinical.parentNode) {
      clinical.parentNode.insertBefore(card, clinical);
    }
  }

  // ─── 5. Inject Leo-specific AI summary on home ──────────────────
  function injectLeoSummary() {
    if (document.getElementById('leo-ai-summary')) return;
    // Only on home
    var path = location.pathname.replace(/\/+$/, '').toLowerCase();
    var last = path.split('/').pop() || 'home';
    last = last.replace(/\.html$/, '');
    if (last && last !== 'home' && last !== 'index' && last !== '') return;

    var card = document.createElement('section');
    card.id = 'leo-ai-summary';
    card.className = 'report-section';
    card.innerHTML =
      '<div class="container">' +
        '<div class="section-label">' +
          '02 · Synthesis <span class="ai-pill">AI</span>' +
        '</div>' +
        '<h2 class="section-title">AI summary · Leo Keller</h2>' +
        '<p class="section-desc">Synthesised across the lab, vitals and imaging history. Medication context is intentionally minimal — Perindopril 4 mg/day is the only prescription on file.</p>' +

        // Risk-tag legend
        '<div class="leo-risk-legend" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:var(--text-muted);margin-bottom:14px;">' +
          '<span style="font-family:\'IBM Plex Mono\',monospace;letter-spacing:0.08em;text-transform:uppercase;font-size:11px;">Risk tags</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;"><span class="pill pill-flag">High</span> immediate clinical attention</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;"><span class="pill pill-watch">Medium</span> watch / address near-term</span>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;"><span class="pill pill-ok">Follow-up</span> routine recheck</span>' +
        '</div>' +

        '<div class="two-col mb-3">' +
          '<div class="list-card">' +
            '<h4>What the data shows</h4>' +
            '<ul class="leo-risk-list" style="list-style:disc;padding-left:20px;">' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Blood pressure</strong> is the primary axis under active management. The 249-reading dataset sits in Stage 1–2 territory (mean ~135 / 90 mmHg) with a peak of <strong>172 / 116</strong>. Perindopril 4 mg/day is the single agent on board — confirm BP response in 4–6 weeks; if mean stays above 130/80, escalate.' +
                '&nbsp;<span class="pill pill-flag" style="margin-left:4px;vertical-align:1px;">High</span>' +
              '</li>' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Elevated homocysteine (14.40 µmol/L)</strong> against normal serum B12 and folate — consistent with sub-optimal one-carbon metabolism (suspected MTHFR polymorphism). Independent cardiovascular risk factor that stacks with the BP picture; consider MTHFR testing + methylated B-complex trial.' +
                '&nbsp;<span class="pill pill-watch" style="margin-left:4px;vertical-align:1px;">Medium</span>' +
              '</li>' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Cervical spine MRI</strong> — multi-level degenerative change C3/4–C6/7 with mild bilateral foraminal narrowing. No cord signal abnormality. Conservative management on imaging grounds; physiotherapy if symptoms present.' +
                '&nbsp;<span class="pill pill-watch" style="margin-left:4px;vertical-align:1px;">Medium</span>' +
              '</li>' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Borderline-elevated creatinine (1.30 mg/dL)</strong> with preserved eGFR (&gt; 60 mL/min). Without nephrotoxic co-medication this most likely reflects hydration noise + muscle mass — repeat in 8–12 weeks under standardised hydration, add Cystatin C if it persists.' +
                '&nbsp;<span class="pill pill-ok" style="margin-left:4px;vertical-align:1px;">Follow-up</span>' +
              '</li>' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Vitamin D, HbA1c, HDL, testosterone, liver enzymes</strong> all in optimal range. Re-check on the standard annual panel cadence.' +
                '&nbsp;<span class="pill pill-ok" style="margin-left:4px;vertical-align:1px;">Follow-up</span>' +
              '</li>' +
            '</ul>' +
          '</div>' +
          '<div class="list-card">' +
            '<h4>Three big insights</h4>' +
            '<ul>' +
              '<li><strong>Physical.</strong> Cardiovascular-focused programming: 150 min/week zone-2 aerobic (cycling, brisk walking, swim) + 2× lower-body strength sessions. The combination targets BP, supports kidney perfusion and is the highest-yield non-pharma move alongside Perindopril.</li>' +
              '<li><strong>Mental.</strong> No structured psychological care or assessment on file. A baseline psychometric (PHQ-9 + GAD-7) + a single intake session with a clinical psychologist gives you a reference point and a channel if stress patterns emerge.</li>' +
              '<li><strong>Spiritual.</strong> <em>TBD.</em> No spiritual / values data captured yet — wheel-of-life, life-event log, or journal entries would let the AI summary include this pillar.</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +

        '<div class="alert alert-info">' +
          '<strong>Recommended next step.</strong> Repeat the full blood &amp; urine panel under standardised conditions to confirm the creatinine trend and re-baseline homocysteine. ' +
          'Independently, an MTHFR polymorphism test (or methylated B-complex supplementation trial) is a reasonable, low-cost diagnostic step given the homocysteine pattern.' +
        '</div>' +
      '</div>';

    // Insert immediately AFTER the Reports section so the home page
    // always opens with Hero → 01 · Browse / Reports → 02 · AI Synthesis
    // → the rest of the page. Find the Reports section by looking for
    // the entry-card-visual grid (a stable, distinctive landmark).
    var reportsSection = null;
    document.querySelectorAll('section.report-section, section.hero, section').forEach(function (s) {
      if (reportsSection) return;
      if (s.querySelector('.entry-card-visual, .entry-grid-visual')) {
        reportsSection = s;
      }
    });
    if (reportsSection && reportsSection.parentNode) {
      reportsSection.parentNode.insertBefore(card, reportsSection.nextSibling);
      return;
    }
    // Fallback: drop at the end of body so we never land above the hero
    document.body.appendChild(card);
  }

  // ─── 6. Adjust the static "page-header" description so the
  // dynamically-replaced text reads coherently on Leo's profile.
  function rewriteHomeHeader() {
    var path = location.pathname.replace(/\/+$/, '').toLowerCase();
    var last = path.split('/').pop() || 'home';
    last = last.replace(/\.html$/, '');
    if (last && last !== 'home' && last !== 'index' && last !== '') return;
    // The home page header is wrapped in .page-header (or section.hero)
    var headerEl = document.querySelector('.page-header .page-desc, .hero .hero-sub');
    if (!headerEl) return;
    headerEl.innerHTML =
      '<span class="lang-en">Leo Keller · 35 · Paris · prepared 25 May 2026. ' +
      'A single antihypertensive (Perindopril 4 mg/day) on the current regimen. The lab, vitals and imaging history on the platform mirror the underlying clinical dataset; the AI insights have been regenerated to reflect this minimal medication context.</span>';
  }

  // Also update the <title> tag, which lives in <head> and isn't
  // touched by walkText (we walk from document.body).
  function rewriteTitle() {
    if (document.title) {
      document.title = document.title
        .replace(/Joao Victor Creste/g, 'Leo Keller')
        .replace(/João Victor Creste/g, 'Leo Keller')
        .replace(/Joao/g, 'Leo')
        .replace(/João/g, 'Leo');
    }
  }

  // ─── Run ────────────────────────────────────────────────────────
  function run() {
    // Hide Joao-specific alerts BEFORE walking text — uses the
    // original Joao names which are clearer trigger words than the
    // post-replacement "Leo" version.
    hideJoaoSpecificAlerts();
    hidePatientPhotos();
    walkText(document.body);
    rewriteTitle();
    hideSelectors();
    stripNavLinks();
    rewriteHomeHeader();
    injectLeoSummary();
    injectPerindoprilCard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

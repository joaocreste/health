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
  ];

  function hideSelectors() {
    HIDE_SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) { el.style.display = 'none'; });
      } catch (_) {}
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

    // Drop it where the meds section used to live on physical.html
    // (right before #clinical, or at the top of <main> on other pages).
    var clinical = document.getElementById('clinical');
    if (clinical && clinical.parentNode) {
      clinical.parentNode.insertBefore(card, clinical);
      return;
    }
    // Fallback: append to body
    document.body.appendChild(card);
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
          '01 · Browse <span class="ai-pill">AI</span>' +
        '</div>' +
        '<h2 class="section-title">AI summary · Leo Keller</h2>' +
        '<p class="section-desc">Synthesised across the lab, vitals and imaging history. Medication context is intentionally minimal — Perindopril 4 mg/day is the only prescription on file.</p>' +

        '<div class="two-col mb-3">' +
          '<div class="list-card">' +
            '<h4>What the data shows</h4>' +
            '<ul>' +
              '<li><strong>Blood pressure</strong> is the primary axis under active management. The 249-reading dataset sits in Stage 1–2 territory (mean ~135 / 90 mmHg) with a peak of 172 / 116. Perindopril 4 mg/day is the single agent on board.</li>' +
              '<li><strong>Borderline-elevated creatinine (1.30 mg/dL)</strong> with preserved eGFR (&gt; 60 mL/min) — without nephrotoxic co-medication, this most likely reflects hydration noise + muscle mass, but it deserves a repeat in 8–12 weeks under standardised hydration.</li>' +
              '<li><strong>Elevated homocysteine (14.40 µmol/L)</strong> against normal serum B12 and folate is consistent with sub-optimal one-carbon metabolism (suspected MTHFR polymorphism). Independent cardiovascular risk factor; pair with the BP picture.</li>' +
              '<li><strong>Cervical spine MRI</strong> shows multi-level degenerative change C3/4–C6/7 with mild bilateral foraminal narrowing — no cord signal abnormality. Conservative management on imaging grounds.</li>' +
              '<li><strong>Vitamin D, HbA1c, HDL, testosterone</strong> are all in the optimal range. Liver function preserved.</li>' +
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

    // Insert as the first content section after the page header
    var firstSection = document.querySelector('main section, body > section');
    if (firstSection && firstSection.parentNode) {
      firstSection.parentNode.insertBefore(card, firstSection);
    } else {
      document.body.appendChild(card);
    }
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

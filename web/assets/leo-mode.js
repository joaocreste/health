/* Lumen Health — leo-mode.js
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

  // Force English locale — Leo's record is EN-only. app.js's initI18n applies
  // the viewer's stored choice (default 'pt') on DOMContentLoaded, which lands
  // AFTER this script's load-time set — so re-apply then too; this listener
  // registers after app.js's, so it runs last and wins. Mirrors applyLang('en')
  // minus the localStorage write: the viewer's own language preference must
  // survive navigating to other patients. The flag toggle is hidden because
  // there is no Portuguese rendering of this record to switch to.
  function forceEnglish() {
    document.documentElement.setAttribute('lang', 'en');
    Array.prototype.forEach.call(document.querySelectorAll('[data-en][data-pt]'), function (el) {
      var value = el.getAttribute('data-en');
      if (value === null) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = value;
      else el.textContent = value;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.lang-btn'), function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang') === 'en'));
      btn.style.display = 'none';
    });
  }
  forceEnglish();
  document.addEventListener('DOMContentLoaded', forceEnglish);

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
    [/\bDias de Souza\b/g, 'Keller'],

    // DOB / age — Joao 17 Oct 1992 (DB shows 1992-10-16 due to UTC) → Leo 17 Jul 1990
    [/17 October 1992/g, '17 July 1990'],
    [/16 October 1992/g, '17 July 1990'],
    [/17 Oct 1992/g, '17 Jul 1990'],
    [/16 Oct 1992/g, '17 Jul 1990'],
    [/17 outubro 1992/g, '17 julho 1990'],
    [/16 outubro 1992/g, '17 julho 1990'],
    [/17 de outubro de 1992/g, '17 de julho de 1990'],
    [/16 de outubro de 1992/g, '16 de julho de 1990'],
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

    // Strip the lone "AUDIT scores" example from the AI-inference legend
    // (the alcohol assessment is removed for Leo; the timeline AUDIT
    // entries are hidden separately by hideShowcaseExtras).
    [/AUDIT scores, /g, ''],
    [/escores AUDIT, /g, ''],
    // GB → FR only on word boundaries where it's clearly the country code.
    // We don't touch arbitrary GB/FR text since the static pages use
    // "GB" in only a few demographic contexts.

    // Report identifiers (MRN / accession / visit / registration numbers) -> synthetic
    [/\b3402824\b/g, '4815162'],
    [/\b3129863\b/g, '2718281'],
    [/\b190830993\b/g, '180550001'],
    [/\b190824100\b/g, '180550002'],
    [/\bE25873959\b/g, 'E31415926'],
    [/\b32088962\/12\b/g, '55110234/12'],
    [/\b4647288\b/g, '5912604'],
    [/\b17723927\b/g, '18904412'],
    [/\b117134640\b/g, '119220555'],
    [/\bNV1X01005196090\b/g, 'NV1X01009999001'],
    [/\bAE23-016535\b/g, 'AE23-099001'],
    [/\b30099223397\b/g, '30011122233'],
    [/\b96425\b/g, '90001'],
    [/\b220106\b/g, '90002'],
    [/\b99607\b/g, '90003'],
    [/\b157890\b/g, '90004'],
    [/\b7096445\b/g, '7000001'],
    [/\b54911\b/g, '90005'],
    [/\b93948\b/g, '90006'],
    [/\b75340\b/g, '90007'],
    [/\b185087\b/g, '90008'],
    [/\b96\.083\b/g, '90.009'],
    [/\b168889\b/g, '90010'],
    [/\b150803\b/g, '90011'],
    [/\b90\.835\b/g, '90.012'],
    [/\b120785\b/g, '90013'],
    [/\b230127\b/g, '90014'],
    [/\b90787\b/g, '90015'],
    [/\b06\/9732\b/g, '06/0001'],
  ];

  function walkText(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      var changed = false;
      for (var i = 0; i < REPLACEMENTS.length; i++) {
        var pair = REPLACEMENTS[i];
        pair[0].lastIndex = 0;
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
    '#mri-head',                       // physical-exams.html: 23 Apr 2022 brain MRI + intracranial angio-MR — not relevant to Leo
    // Imaging studies removed from Leo's showcase profile (per request):
    '#mri-cervical',                   // physical-exams.html: MRI cervical spine · 26 Mar 2026
    '#us-face-2026',                   // physical-exams.html: Dermatologic Ultrasound · forehead · 8 Jun 2026
    '#imaging',                        // physical-exams.html: CT facial sinuses (12 Jan 2026) + US-guided biopsy (16 Mar 2023)
    '#tc-heart',                       // physical-exams.html: Coronary CT angiography · 19 Jul 2023
    // Alcohol / AUDIT assessment removed from Leo's profile:
    '#alcohol',                        // physical-exams.html: Alcohol Pattern Assessment — AUDIT 13/40
    // Crisis / suicidality removed from Leo's profile:
    '#crisis-29apr',                   // mental.html: 29 Apr 2026 intentional-overdose top callout
    '.psych-dim-panel[data-dim="risk"]', // mental.html: "Risk / protective factors" dimension (hopelessness / self-harm)
    '.psych-dim-card[data-dim="risk"]',  // mental.html: its nav card in the dimension grid
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

  // Overdose / suicidality / benzodiazepine scrubber for Leo.
  // Leo is on Perindopril only — no benzodiazepines, no SSRIs, no
  // psychiatric history on file. The static HTML carries Joao's
  // 29 Apr 2026 intentional overdose, related self-harm / suicidal
  // ideation reclassification, and benzo-withdrawal narrative across
  // home / physical / mental / spiritual / assessment / vitals. This
  // function walks the DOM and hides every container that mentions any
  // of those topics, climbing to the nearest sensible ancestor
  // (.alert, tr, li, .psych-item, .sp-tl-item, .timeline-event,
  // blockquote, .callout) so we drop a clean unit rather than a stray
  // word.
  function hideOverdoseSuicidalAndBenzo() {
    var triggers = [
      // Overdose / suicide attempt / SI vocabulary
      'intentional overdose', 'Intentional overdose',
      'intentional benzodiazepine overdose', 'Intentional benzodiazepine overdose',
      'OD episode', 'OD now satisfies',
      'self-poisoning', 'Self-poisoning',
      'suicidality', 'Suicidality', 'Suicidalidade', 'suicidalidade',
      'suicidal ideation', 'Suicidal ideation',
      'suicidal thoughts', 'pensamentos suicidas',
      'suicidal behaviour', 'suicidal behavior', 'comportamento suicida',
      'suicide risk', 'Suicide risk', 'Suicide-risk', 'suicide-risk',
      'tentativa de suicídio',
      'suicide attempt', 'Suicide attempt', 'non-fatal suicide attempt',
      'self-harm', 'Self-harm',
      'Quasi-suicidal', 'quasi-suicidal',
      'Recent intentional overdose',
      // The 29 April 2026 anchor date (EN + PT variants)
      '29 April 2026', '29 Apr 2026', '29 April overdose', '29 Apr overdose',
      '29 abril 2026', '29 abr 2026', '29 de abril de 2026',
      'Sobredose', 'sobredose',
      // PT suicidality vocabulary
      'Risco de suicídio', 'risco de suicídio',
      'ideação suicida', 'Ideação suicida',
      'auto-resgate',
      // Self-rescue framing
      '999 self-rescue', 'self-rescue via 999', '999 call',
      // Benzodiazepines / Valium / Diazepam (Leo is not on these)
      'benzodiazepine', 'Benzodiazepine',
      'benzodiazepínico', 'Benzodiazepínico',
      'Valium', 'Xanax', 'Xanax/Valium',
      'Diazepam', 'diazepam',
      'alprazolam', 'Alprazolam',
      // Crisis narrative artefacts that are 29-Apr-tied
      'Crisis Episode April',
      'Eu_preciso_que_voce_ainda_viva',
      // Polypharmacy fingerprint of the OD cocktail
      'pregabalin, quetiapine, duloxetine and Depakote',
      'pregabalina, quetiapina, duloxetina e Depakote',
    ];

    var containerSelectors = [
      '.alert', '.alert-flag', '.alert-info', '.alert-watch', '.alert-warn', '.alert-ok',
      '.psych-item', '.psych-subitem',
      '.sp-tl-item',
      '.timeline-event', '.timeline-entry', '.timeline-item',
      'tr',
      'li',
      'blockquote',
      '.callout',
    ];

    var candidates = document.querySelectorAll(
      '.alert, .alert-flag, .alert-info, .alert-watch, .alert-warn, .alert-ok, ' +
      '.psych-item, .psych-subitem, .sp-tl-item, ' +
      '.timeline-event, .timeline-entry, .timeline-item, ' +
      'tr, li, blockquote, p, td, .callout'
    );

    candidates.forEach(function (el) {
      var t = el.textContent || '';
      if (!t) return;
      var hit = false;
      for (var i = 0; i < triggers.length; i++) {
        if (t.indexOf(triggers[i]) !== -1) { hit = true; break; }
      }
      if (!hit) return;
      // Climb to the nearest hideable container.
      var node = el;
      var container = null;
      while (node && node !== document.body) {
        if (node.matches) {
          for (var j = 0; j < containerSelectors.length; j++) {
            if (node.matches(containerSelectors[j])) {
              container = node;
              break;
            }
          }
          if (container) break;
        }
        node = node.parentElement;
      }
      (container || el).style.display = 'none';
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

  // After hiding, the static section-label numbers (1, 1.a-1.f, 2, 3, 4
  // on the exams page) will skip any hidden block. Walk every still-
  // visible .section-label in document order and rewrite its leading
  // prefix so the sequence stays tight. Top-level labels ("N · X")
  // bump the top counter and reset the sub counter; sub-labels
  // ("N.x · X") consume the next letter under the current top.
  function renumberVisibleSectionLabels() {
    var labels = document.querySelectorAll('.section-label');
    if (!labels.length) return;
    var topIdx = 0;
    var subIdx = 0;
    var letters = 'abcdefghijklmnopqrstuvwxyz';
    var topRe = /^\d+\s*·\s*/;
    var subRe = /^\d+\.[a-z]\s*·\s*/;

    labels.forEach(function (lbl) {
      // Skip if any ancestor was hidden by display:none in this script
      var node = lbl;
      while (node && node !== document.body) {
        if (node.style && node.style.display === 'none') return;
        node = node.parentElement;
      }

      var spans = lbl.querySelectorAll('span.lang-en, span.lang-pt');
      var sample = spans.length ? spans[0].textContent : lbl.textContent;
      var prefix, re;
      if (subRe.test(sample)) {
        prefix = topIdx + '.' + letters[subIdx] + ' · ';
        subIdx++;
        re = subRe;
      } else if (topRe.test(sample)) {
        topIdx++;
        subIdx = 0;
        prefix = topIdx + ' · ';
        re = topRe;
      } else {
        return;
      }

      if (spans.length) {
        spans.forEach(function (s) {
          s.textContent = s.textContent.replace(re, prefix);
        });
      } else {
        // Rewrite the prefix inside the first matching text node so any child
        // elements (e.g. an ai-pill badge on the injected Synthesis card)
        // survive — setting lbl.textContent would flatten them away.
        var tnode = null;
        for (var k = 0; k < lbl.childNodes.length; k++) {
          var cn = lbl.childNodes[k];
          if (cn.nodeType === 3 && re.test(cn.nodeValue)) { tnode = cn; break; }
        }
        if (tnode) tnode.nodeValue = tnode.nodeValue.replace(re, prefix);
        else lbl.textContent = lbl.textContent.replace(re, prefix);
      }
    });
  }

  // ─── 3. Strip nav links that don't apply to Leo's reduced view ──
  // (Leo has no medications nav target on physical, no osteopath
  // sub-target on vitals — keep the section-nav clean.)
  function stripNavLinks() {
    var hideHashes = ['#meds', '#assessment',
      '#mri-cervical', '#us-face-2026', '#imaging', '#tc-heart', '#alcohol', '#crisis-29apr'];
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
      // Insert AFTER clinical history (the now-hidden #meds slot, which sits
      // right after #clinical) so the renumber pass reads 01 Clinical history
      // -> 02 Pharmacology rather than reversing the two.
      clinical.parentNode.insertBefore(card, clinical.nextSibling);
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
        '<p class="section-desc">Synthesised across the lab, vitals, imaging and genetics history. Medication context is intentionally minimal — Perindopril 4 mg/day is the only prescription on file.</p>' +

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
                '<strong>Blood pressure</strong> is the primary axis under active management. The 249-reading home dataset (since 13 Nov 2025) sits in Stage 1–2 territory (mean <strong>135.2 / 90.8 mmHg</strong>) with a peak of <strong>172 / 116</strong>. Perindopril 4 mg/day is the single agent on board — worth confirming BP response with your clinician in 4–6 weeks; if the mean stays above 130/80, an escalation is reasonable to discuss.' +
                '&nbsp;<span class="pill pill-flag" style="margin-left:4px;vertical-align:1px;">High</span>' +
              '</li>' +
              '<li style="margin-bottom:10px;">' +
                '<strong>Elevated homocysteine (14.40 µmol/L)</strong> despite high-normal serum B12 (863) and normal folate, now explained by a <strong>confirmed MTHFR compound heterozygote</strong> on the genetics panel (C677T <em>rs1801133</em> + A1298C <em>rs1801131</em>, ~50% reduced enzyme activity) — the classic pattern where unmethylated B-vitamins fail to clear homocysteine. An independent cardiovascular risk factor that stacks with the BP axis; an L-methylfolate adjunct is the targeted, low-cost step worth discussing with your clinician.' +
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
          'Because the MTHFR compound-heterozygote genotype is already confirmed on the genetics panel, the open question is response rather than diagnosis — an L-methylfolate trial is a reasonable, low-cost step worth discussing with your clinician.' +
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

  // ─── 7. Inject Leo-appropriate lab explanation cards on outliers ─
  // The static page's per-marker notes + "Possible contributing
  // factors" lists are written around Joao's polypharmacy and are hidden
  // for Leo (see HIDE_SELECTORS / hideJoaoSpecificAlerts). For each
  // out-of-range marker in the Blood & urine panel we graft a
  // Leo-specific explanation (Perindopril-only context, the confirmed
  // MTHFR genotype, no psych meds) so every outlier carries a short
  // explanation + a next step. Reuses the native .lab-note / .lab-causes
  // markup so styling matches the rest of the panel. MUST run after
  // hideSelectors() so these injected blocks are not swept by the hide
  // pass. Idempotent (guards on .leo-lab-explain). Matches only
  // non-normal cards to avoid grabbing a same-named normal marker.
  var LEO_LAB_OUTLIERS = [
    {
      key: 'Homocysteine',
      note: 'Above the upper reference limit (14.40 vs &lt;10 µmol/L). An independent cardiovascular risk marker that compounds the blood-pressure picture.',
      factors: [
        'Confirmed MTHFR compound heterozygote (C677T + A1298C, ~50% reduced enzyme activity) on the genetics panel — the methylation bottleneck that lets homocysteine accumulate.',
        'Serum B12 (863) and folate are normal, so the issue is conversion, not substrate.',
        'No B6 deficiency signals elsewhere on the panel.',
        'Next step: a trial of L-methylfolate, which bypasses the MTHFR step, with a recheck in 8–12 weeks — worth discussing with your clinician.',
      ],
    },
    {
      key: 'hs-CRP',
      note: 'Markedly above the 3 mg/L cardiovascular threshold (12.10 mg/L). At this magnitude it usually reflects an acute or recent inflammatory or infectious process at the time of the draw rather than a stable baseline.',
      factors: [
        'A transient infection, recent illness or minor injury near the collection date can push hs-CRP into double digits.',
        'Low-grade musculoskeletal or soft-tissue inflammation can add a smaller contribution.',
        'Adiposity-driven low-grade inflammation is a minor chronic contributor.',
        'Next step: repeat once fully symptom-free to separate a transient spike from a persistent elevation; if it stays above 3 mg/L it becomes relevant to the cardiovascular risk already flagged by the BP and homocysteine — discuss with your clinician.',
      ],
    },
    {
      key: 'Creatinine',
      note: 'At the upper edge of normal (1.30 mg/dL) with a preserved eGFR above 60 mL/min — filtration remains in range.',
      factors: [
        'Perindopril, the single active medication, lowers intraglomerular pressure; a small creatinine rise after starting an ACE inhibitor is expected and usually benign (up to roughly 30 percent).',
        'Hydration at collection and muscle mass both raise creatinine independently of kidney function.',
        'No nephrotoxic co-medication is on the regimen.',
        'Next step: recheck creatinine and electrolytes 1–2 weeks after any Perindopril dose change, and add Cystatin C if the value persists — worth discussing with your clinician.',
      ],
    },
    {
      key: 'Total Cholesterol',
      note: 'At the top of the desirable band (199 mg/dL). Total cholesterol on its own is not actionable — the fractions are what matter.',
      factors: [
        'Total cholesterol bundles HDL (protective) and LDL (atherogenic); a high HDL can lift the total without raising risk.',
        'Diet and genetics are the usual drivers.',
        'Next step: a fasting lipid panel (LDL, HDL, triglycerides, non-HDL) to see which fraction is driving the number — relevant because BP and homocysteine already place this in a cardiovascular-risk context.',
      ],
    },
    {
      key: 'Estradiol',
      note: 'Mildly elevated for an adult male (47.62 pg/mL). A single reading is sensitive to timing and assay.',
      factors: [
        'Peripheral aromatisation of testosterone to estradiol in adipose tissue is the most common driver in men.',
        'Collection timing and the specific immunoassay can shift the number.',
        'Next step: repeat on a morning sample alongside total testosterone and SHBG to read the testosterone-to-estradiol balance rather than estradiol in isolation.',
      ],
    },
    {
      key: 'DHEA',
      note: 'Exactly at the lower limit of the male range (2.50 ng/mL). On its own this is a soft signal of adrenal-axis output.',
      factors: [
        'DHEA declines naturally with age and falls further under sustained stress and short sleep.',
        'No medication on the current regimen suppresses the adrenal axis — Perindopril does not.',
        'Read alongside a morning cortisol: a low-bound cortisol with a low-bound DHEA points to adrenal depletion rather than insufficiency, which is clinically distinct from primary adrenal insufficiency (Addison disease).',
        'Next step: recheck DHEA-S with an 8 a.m. cortisol before drawing conclusions from a single lower-limit value.',
      ],
    },
    {
      key: 'Urinary specific gravity',
      note: 'A dilute urine sample (1.005). This is mainly a flag about collection conditions rather than a kidney finding.',
      factors: [
        'High fluid intake before collection produces a dilute sample (1.005 sits at the low end).',
        'A dilute sample also lowers the apparent concentration of other markers measured on the same urine.',
        'Next step: repeat with a first-morning, pre-hydration sample for a representative concentrating-ability reading.',
      ],
    },
    {
      key: 'Progesterone',
      note: 'Expected to be low in an adult male (&lt;0.21 ng/mL) — shown for completeness. No action indicated.',
      factors: [],
    },
  ];

  function injectLeoLabExplanations() {
    var cards = document.querySelectorAll('.lab-test');
    if (!cards.length) return;
    var DISCLAIMER =
      '<span class="lab-causes-disclaimer"><span class="lang-en">— suggestive only, ' +
      'based on current medication and history. Does not replace clinical evaluation.</span></span>';

    LEO_LAB_OUTLIERS.forEach(function (o) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.classList.contains('lab-test-normal')) continue;
        var nameEl = card.querySelector('.lab-test-name');
        if (!nameEl || (nameEl.textContent || '').indexOf(o.key) === -1) continue;
        if (card.querySelector('.leo-lab-explain')) return; // already injected
        var wrap = document.createElement('div');
        wrap.className = 'leo-lab-explain';
        var html = '';
        if (o.note) {
          html += '<div class="lab-note"><span class="lang-en">' + o.note + '</span></div>';
        }
        if (o.factors && o.factors.length) {
          var lis = o.factors.map(function (f) { return '<li>' + f + '</li>'; }).join('');
          html +=
            '<div class="lab-causes">' +
              '<div class="lab-causes-title">' +
                '<span class="lang-en">Possible contributing factors</span>' +
                DISCLAIMER +
              '</div>' +
              '<ul class="lab-causes-list lang-en">' + lis + '</ul>' +
            '</div>';
        }
        wrap.innerHTML = html;
        // Insert after the reference foot so the explanation sits above
        // any click-to-expand history table grafted by patient-context.
        var foot = card.querySelector('.lab-test-foot');
        if (foot && foot.parentNode) {
          foot.parentNode.insertBefore(wrap, foot.nextSibling);
        } else {
          card.appendChild(wrap);
        }
        return; // one card per outlier
      }
    });
  }

  // ─── Showcase scrub ─────────────────────────────────────────────
  // Leo is a curated demo profile. Beyond hiding the removed imaging
  // viewers (HIDE_SELECTORS) and the AUDIT section (#alcohol), the static
  // pages carry stray *text* references to those studies and to the
  // alcohol assessment in summary lists, metric cards and timelines.
  // Hide any small container that names them, and rewrite the exams-page
  // intro so it no longer lists studies that are gone. Runs on original
  // (pre-inject) static content, so injected Leo cards are never touched.
  function hideShowcaseExtras() {
    var AUDIT_TRIGGERS = [
      'AUDIT', 'Alcohol Pattern', 'Alcohol use disorder', 'alcohol use disorder',
      'Reactive alcohol', 'reactive alcohol',
    ];
    var IMG_TRIGGERS = [
      'CT facial sinuses', 'TC dos seios da face',
      'MRI cervical', 'cervical spine MRI', 'RM cervical', 'RM da coluna cervical',
      'coronary CT', 'Coronary CT', 'angio-TC coronariana',
      'Dermatologic Ultrasound', 'dermatologic ultrasound', 'ultrassom dermatológico',
      'US-guided biopsy', 'biópsia guiada por US',
    ];
    var CONTAINERS = [
      '.metric-card', '.timeline-event', '.timeline-entry', '.timeline-item',
      '.alert', '.alert-flag', '.alert-info', '.alert-watch',
      'li', 'tr', '.section-desc', '.callout',
    ];
    document.querySelectorAll(
      '.metric-card, .timeline-event, .timeline-entry, .timeline-item, ' +
      '.alert, .alert-flag, .alert-info, .alert-watch, li, tr, .section-desc, .callout'
    ).forEach(function (el) {
      var t = el.textContent || '';
      if (!t) return;
      var hit = false, k;
      for (k = 0; k < AUDIT_TRIGGERS.length; k++) { if (t.indexOf(AUDIT_TRIGGERS[k]) !== -1) { hit = true; break; } }
      if (!hit) { for (k = 0; k < IMG_TRIGGERS.length; k++) { if (t.indexOf(IMG_TRIGGERS[k]) !== -1) { hit = true; break; } } }
      if (!hit) return;
      var node = el, container = null;
      while (node && node !== document.body) {
        if (node.matches) {
          for (var j = 0; j < CONTAINERS.length; j++) {
            if (node.matches(CONTAINERS[j])) { container = node; break; }
          }
          if (container) break;
        }
        node = node.parentElement;
      }
      (container || el).style.display = 'none';
    });

    // Rewrite the exams-page intro so it doesn't list removed studies.
    var path = location.pathname.replace(/\/+$/, '').toLowerCase();
    var last = (path.split('/').pop() || '').replace(/\.html$/, '');
    if (last === 'physical-exams') {
      var pd = document.querySelector('.page-header .page-desc, .page-desc');
      if (pd) {
        pd.innerHTML =
          '<span class="lang-en">Point-in-time clinical exams and lab results — radiology ' +
          '(MRI brain, lumbar MRI + CT, EEG), a full blood &amp; urine panel and gut microbiota sequencing.</span>';
      }
    }
  }

  // ─── Run ────────────────────────────────────────────────────────
  function run() {
    // Hide Joao-specific alerts BEFORE walking text — uses the
    // original Joao names which are clearer trigger words than the
    // post-replacement "Leo" version.
    hideOverdoseSuicidalAndBenzo();
    hideJoaoSpecificAlerts();
    hidePatientPhotos();
    hideShowcaseExtras();
    walkText(document.body);
    rewriteTitle();
    hideSelectors();
    stripNavLinks();
    rewriteHomeHeader();
    injectLeoSummary();
    // injectPerindoprilCard();  // disabled: Leo's medications were deleted (no meds shown).
    injectLeoLabExplanations();
    // Renumber LAST: the injected cards (Synthesis on home, Pharmacology on
    // physical) carry hardcoded prefixes and must participate in the
    // sequential pass, otherwise they collide with the static labels that
    // follow them (duplicate "02", out-of-order numbering).
    renumberVisibleSectionLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

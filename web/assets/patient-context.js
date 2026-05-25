/* JC Advisory — patient-context.js
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
          el.classList.contains('jc-silvana-exams') ||
          el.classList.contains('jc-danger-zone') ||
          el.classList.contains('jc-danger-backdrop')) continue;
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
  function renderHome(summary) {
    var p = (summary && summary.patient) || {};
    var name = p.full_name || 'this patient';

    document.title = 'JC Advisory — Health Summary · ' + name;

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
    overview.innerHTML = hero + reports;
    document.body.appendChild(overview);
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
    return (
      '<div class="lab-test lab-test-' + status + '">' +
        '<div class="lab-test-head">' +
          '<div class="lab-test-name">' + (m.marker_html || escapeHtml(m.marker)) + '</div>' +
          '<div class="lab-test-meta">' +
            '<span class="lab-test-val">' + valHtml + '</span>' +
            '<span class="pill ' + pillCls + '">' + pillLabel(status, m.flag) + '</span>' +
          '</div>' +
        '</div>' +
        renderLabBar(value, m.ref_low, m.ref_high, status) +
        '<div class="lab-test-foot">' +
          '<div class="lab-test-ref">' + t('Reference:', 'Referência:') + ' ' + formatRefText(m.ref_low, m.ref_high, m.unit) + '</div>' +
          subline +
        '</div>' +
      '</div>'
    );
  }

  function renderExams(exams) {
    var p = exams.patient || {};
    var panels = exams.panels || [];
    var docs = exams.lab_documents || [];
    var imaging = exams.imaging || [];

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
                '<span class="lab-panel-title">' + escapeHtml(pn.panel) + '</span>' +
                '<span class="lab-panel-sub"></span>' +
                '<span class="lab-panel-count">' + countHtml + '</span>' +
              '</summary>' +
              '<div class="lab-panel-body">' + body + '</div>' +
            '</details>'
          );
        }).join('') + '</div>';

    var imagingHtml = imaging.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>' + t('Imaging studies', 'Estudos de imagem') + ' <span class="ov-count-inline">' + imaging.length + '</span></h2>' +
        '<ul class="ov-list">' + imaging.map(function (s) {
          var filesLabel = s.file_count ? ' · ' + s.file_count + ' ' + t('files', 'arquivos') : '';
          return '<li>' +
            '<span class="ov-list-title">' + escapeHtml(s.modality || '?') +
              (s.body_part ? ' · ' + escapeHtml(s.body_part) : '') + '</span>' +
            '<span class="ov-list-meta">' + escapeHtml(formatDate(s.study_date)) +
              filesLabel +
              ' · ' + escapeHtml(s.source_format || '—') +
            '</span></li>';
        }).join('') + '</ul>' +
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

    var comparisonHtml = renderHistoricalComparison(panels);

    var view = document.createElement('main');
    view.className = 'jc-overview jc-exams';
    view.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        '<div class="ov-section-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
        panelsHtml +
        comparisonHtml +
        imagingHtml +
        docsHtml +
      '</div>';
    document.body.appendChild(view);
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
            '<th class="lab-cmp-marker">' + escapeHtml(m.marker) + unit + '</th>' +
            cells +
          '</tr>'
        );
      }).join('');
      return (
        '<tr class="lab-cmp-section"><th colspan="' + (samples.length + 1) + '">' + escapeHtml(pn.panel) + '</th></tr>' +
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

    document.title = 'JC Advisory — ' + opts.title + ' · ' + (p.full_name || 'Patient');

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

  function renderPhysical(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    var labs = summary.recent_labs || [];
    var docs = (summary.recent_documents || []).filter(function (d) {
      return ['lab_pdf', 'imaging_image', 'dicom_series', 'ecg_pdf', 'doctor_report', 'medication_csv', 'genetics_report'].indexOf(d.kind) !== -1;
    });
    var metrics = [
      { label: t('Lab markers',     'Marcadores laboratoriais'), value: b.lab_results     || 0, href: 'physical-exams.html' },
      { label: t('Imaging studies', 'Estudos de imagem'),        value: b.imaging_studies || 0, href: 'physical-exams.html' },
      { label: t('Vitals days',     'Dias de vitais'),           value: b.vitals_days     || 0, href: 'physical-vitals.html' },
      { label: t('ECG events',      'Eventos de ECG'),           value: b.ecg_events      || 0, href: 'physical-vitals.html' },
      { label: t('Genetics (PGx)',  'Genética (PGx)'),           value: b.pgx_findings    || 0, href: 'physical-genetics.html' },
      { label: t('Medications',     'Medicamentos'),             value: b.medications     || 0 },
      { label: t('Supplements',     'Suplementos'),              value: b.supplements     || 0 },
      { label: t('Encounters',      'Consultas'),                value: b.encounters      || 0 },
      { label: t('Surgeries',       'Cirurgias'),                value: b.surgeries       || 0 },
      { label: t('Injuries',        'Lesões'),                   value: b.injuries        || 0 },
    ];
    var extra =
      (labs.length === 0 ? '' :
        recentSection(t('Recent lab results', 'Resultados recentes'), labs.length, renderLabList(labs.slice(0, 8)))) +
      (docs.length === 0 ? '' :
        recentSection(t('Recent documents',   'Documentos recentes'), docs.length, renderDocList(docs.slice(0, 8))));
    renderSectionView({
      summary: summary, title: 'Physical',
      eyebrow: t('Physical', 'Físico'),
      metrics: metrics, extra: extra,
      emptyHint: t('Nothing physical ingested yet. Drop lab PDFs, ECGs, imaging or vitals exports from Add data.',
                   'Nada físico ingerido ainda. Envie PDFs de exames, ECGs, imagens ou exports de vitais em "Adicionar dados".'),
    });
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
      '.ov-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 18px 20px; }',
      '.ov-card-narrative { border-top: 3px solid #B8954A; }',
      '.ov-card-panel     { border-top: 3px solid #244E6E; }',
      '.ov-card-timeline  { border-top: 3px solid #3E7CA3; }',
      '.ov-card-flags     { border-top: 3px solid #7A2E22; }',
      '.ov-card-empty     { border-top: 3px solid #DDD8CC; }',
      '.ov-card-head { margin-bottom: 10px; }',
      '.ov-card-head h3 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 15px; color: #0D1B2A; margin: 0 0 4px; letter-spacing: 0; text-transform: none; }',
      '.ov-card-subtitle { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; letter-spacing: 0.04em; }',
      '.ov-card-body p { margin: 0 0 10px; line-height: 1.55; font-size: 14px; color: #1E2D3D; font-family: "IBM Plex Sans", sans-serif; }',
      '.ov-card-body p:last-child { margin-bottom: 0; }',
      '.ov-card-empty p { margin: 0; font-size: 13px; color: #7A8FA6; }',
      '.ov-card .exam-table { margin-top: 4px; }',
      '.ov-card .lab-panel-body { padding: 8px 0 0; border-top: 1px solid #E5E2DC; }',
      '.lab-panel-body-flat { padding: 0; border-top: none; }',
      // Flagged cells in the historical-comparison table
      '.lab-cmp-val[data-flag="high"] { color: #7A2E22; }',
      '.lab-cmp-val[data-flag="low"]  { color: #B8862B; }',
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
      '.ov-chart-wrap { margin-top: 6px; }',
      '.ov-chart { width: 100%; max-width: 100%; height: auto; display: block; }',
      '.ov-pt-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }',
      '.ov-pt-pill { display: inline-flex; align-items: baseline; gap: 6px; background: #F4F1EA; border: 1px solid #DDD8CC; border-radius: 6px; padding: 3px 8px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #1E2D3D; }',
      '.ov-pt-pill .ov-pt-date { color: #7A8FA6; }',
      '.ov-pt-pill .ov-pt-val { font-weight: 500; }',
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
  }

  // insertAfterEl: optional. When the patient's home is rendered by JS
  // (non-Patient-Zero), pass the just-appended <main> so the zone lands
  // beneath it. When omitted (Patient Zero's static page), fall back to
  // "before footer" → "append to body".
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

  ready(function () {
    injectChangeButton();
    // Patient Zero's home is a static page that ends in <footer> — we can
    // inject the danger zone right away, before the footer.
    if (patient === PATIENT_ZERO || patient === LEO_KELLER) {
      if (currentSection() === 'home') {
        injectStyles();
        injectDangerZone();
      }
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
        return;
      }
      if (patient === SILVANA_CRESTE) {
        renderSilvanaPhysicalExams();
        return;
      }
      fetch('/api/patient-exams?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (e) { renderExams(e); decorateWithDashboard('physical'); })
        .catch(function () { renderEmptyShell(patient, null, t('Physical → Exams', 'Físico → Exames')); });
      return;
    }

    // Paulo's only physical data is the manually-curated MRI pair, so
    // every Physical sub-page short-circuits to the bespoke MRI page.
    // Avoids the "0 / 0 / 0" metric grid that hides the actual content.
    if (patient === PAULO_SILOTTO &&
        (section === 'physical' || section === 'physical-vitals' || section === 'physical-genetics')) {
      renderPauloPhysicalExams();
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

  function renderCardNarrative(c) {
    return (
      '<section class="ov-card ov-card-narrative">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
        '<div class="ov-card-body">' + mdToHtml(c.body_md || '') + '</div>' +
      '</section>'
    );
  }

  function renderCardPanelSnapshot(c) {
    var tests = (c.markers || []).map(renderLabTest).join('');
    return (
      '<section class="ov-card ov-card-panel">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
        '<div class="lab-panel-body">' + tests + '</div>' +
      '</section>'
    );
  }

  function renderCardMarkerTimeline(c) {
    var points = (c.points || []).slice().sort(function (a, b) {
      return dateMs(a.date) - dateMs(b.date);
    });
    var ref = refRangeStr(c.ref_low, c.ref_high);
    var refLine = (ref !== '—' ? '<div class="ov-card-subtitle">' + t('Reference:', 'Referência:') + ' ' + escapeHtml(ref) + (c.unit ? ' ' + escapeHtml(c.unit) : '') + '</div>' : '');
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
      '<section class="ov-card ov-card-timeline">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
          refLine +
        '</header>' +
        '<div class="ov-chart-wrap">' + chart + '</div>' +
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
      '<section class="ov-card ov-card-timeline">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
        '<div class="ov-chart-wrap">' + chart + '</div>' +
      '</section>'
    );
  }

  function renderCardFlagList(c) {
    var tests = (c.items || []).map(renderLabTest).join('');
    return (
      '<section class="ov-card ov-card-flags">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
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
      labelEn: '09A · MRI · Cervical spine',
      labelPt: '09A · RM · Coluna cervical',
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
      labelEn: '09A · MRI · Lumbar spine',
      labelPt: '09A · RM · Coluna lombar',
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
        '<div class="section-label">' + t('09A · MRI · Spine', '09A · RM · Coluna') + '</div>' +
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

  function renderPauloPhysicalExams() {
    injectPauloExamsStyles();

    document.title = 'JC Advisory — Physical · Imaging exams · Paulo Silotto Souza';

    var hero =
      '<section class="hero">' +
        '<div class="container">' +
          '<div class="hero-eyebrow">' + t('Physical → Exams', 'Físico → Exames') + '</div>' +
          '<h1 class="hero-title">' +
            t('Imaging exams · Paulo Silotto Souza',
              'Exames de imagem · Paulo Silotto Souza') +
          '</h1>' +
          '<p class="hero-sub">' +
            t('Two MRI studies acquired on 15 May 2026 at CETAM Diagnóstico, reported by Dr. Marco Antonio de Carvalho (CRM-99607). Each viewer carries axial, coronal and sagittal acquisitions — switch plane with the AXI / COR / SAG buttons inside the viewer, then drag the slider (or use mouse wheel, click-and-drag, or arrow keys) to walk through the slices. The radiologist&apos;s full report is rendered below each viewer, with the original Portuguese and an English translation that follow the top-bar language toggle.',
              'Dois estudos de RM realizados em 15 de maio de 2026 no CETAM Diagnóstico, laudados pelo Dr. Marco Antonio de Carvalho (CRM-99607). Cada visualizador contém as aquisições axial, coronal e sagital — alterne o plano com os botões AXI / COR / SAG dentro do visualizador e depois arraste o controle (ou use a rolagem do mouse, clicar-e-arrastar ou as setas) para percorrer os cortes. O laudo completo do radiologista está renderizado abaixo de cada visualizador, com o original em português e uma tradução em inglês que acompanham o seletor de idioma da barra superior.') +
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
              '<span>' + t('Exam date', 'Data do exame') + '</span>' +
              '<span>' + t('15 May 2026', '15 mai 2026') + '</span>' +
            '</div>' +
            '<div class="hero-meta-item">' +
              '<span>' + t('Reporting physician', 'Médico responsável') + '</span>' +
              '<span>Dr. Marco A. de Carvalho · CRM-99607</span>' +
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
              '<h2>' + t('AI summary · Cervical &amp; lumbar MRI', 'Resumo da IA · RM cervical e lombar') + '</h2>' +
              '<span class="ai-pill">AI</span>' +
            '</header>' +
            '<div class="paulo-ai-summary-meta">' +
              t('Synthesised from both radiology reports · 15 May 2026 · CETAM Diagnóstico',
                'Sintetizado a partir dos dois laudos radiológicos · 15 de maio de 2026 · CETAM Diagnóstico') +
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
            t('09A · Imagery', '09A · Imagem') +
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

    var main = document.createElement('main');
    main.className = 'jc-paulo-exams';
    main.innerHTML = hero + aiSummary + imagery;
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

  function silvanaHistoricalComparison(panels) {
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
    (window.SILVANA_LABS.documents || []).forEach(function (d) { docByDate[d.date] = d; });
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
      return (
        '<li class="silv-doc">' +
          '<a href="scans/' + escapeHtml(d.pdf) + '" download class="silv-doc-link">' +
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
    ].join('\n');
    document.head.appendChild(s);
  }

  /* Physical → overview landing for Silvana. Two entry cards, modeled
     on Joao's physical.html: Sinais Vitais and Exames. Genetics is
     intentionally out for now — no data uploaded yet. */
  function renderSilvanaPhysicalLanding() {
    injectSilvanaStyles();
    injectSilvanaLandingStyles();
    document.title = 'JC Advisory — Physical · Silvana Creste';

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
    document.title = 'JC Advisory — Physical · Exams · Silvana Creste';

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
    return (
      '<svg class="silv-fig" viewBox="0 0 220 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="110" cy="32" r="22" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        '<path d="M100,52 L120,52 L122,66 L98,66 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        // torso
        '<path d="M70,68 L150,68 L156,200 L64,200 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        // left arm (viewer left = patient left, InBody convention)
        '<path d="M70,68 L40,80 L34,210 L52,214 L68,200 L70,68 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        // right arm
        '<path d="M150,68 L180,80 L186,210 L168,214 L152,200 L150,68 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        // left leg
        '<path d="M64,200 L108,200 L102,360 L74,360 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
        // right leg
        '<path d="M112,200 L156,200 L146,360 L118,360 Z" fill="#D8E8F2" stroke="#244E6E" stroke-width="2"/>' +
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

  function renderSilvanaVitals() {
    injectSilvanaStyles();
    injectSilvanaVitalsStyles();
    document.title = 'JC Advisory — Vitals · Silvana Creste';

    var data = SILVANA_INBODY;

    var content =
      '<section id="silv-content">' +
        '<div class="container">' +
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

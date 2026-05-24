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

  var PATIENT_ZERO  = 'pending:joao';
  var PAULO_SILOTTO = 'pending:paulo-silotto-df3441';

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
          '<div class="lab-test-name">' + escapeHtml(m.marker) + '</div>' +
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
    if (patient === PATIENT_ZERO) {
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
      fetch('/api/patient-exams?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (e) { renderExams(e); decorateWithDashboard('physical'); })
        .catch(function () { renderEmptyShell(patient, null, t('Physical → Exams', 'Físico → Exames')); });
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
      blurbEn: 'MRI of the cervical spine without intravenous contrast, multi-planar T1, T2 and STIR sequences. Three orientations were acquired — axial (60 slices), coronal (24) and sagittal (93). Use the AXI / COR / SAG buttons inside the viewer to switch plane, then scrub the slider to walk through the slices.',
      blurbPt: 'Ressonância da coluna cervical sem contraste endovenoso, sequências multiplanares em T1, T2 e STIR. Três orientações adquiridas — axial (60 cortes), coronal (24) e sagital (93). Use os botões AXI / COR / SAG no visualizador para alternar o plano e depois deslize o controle para percorrer os cortes.',
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
      blurbEn: 'MRI of the lumbar spine without intravenous contrast, multi-planar T1, T2 and STIR sequences. Three orientations were acquired — axial (60 slices), coronal (24) and sagittal (93). Use the AXI / COR / SAG buttons inside the viewer to switch plane, then scrub the slider to walk through the slices.',
      blurbPt: 'Ressonância da coluna lombar sem contraste endovenoso, sequências multiplanares em T1, T2 e STIR. Três orientações adquiridas — axial (60 cortes), coronal (24) e sagital (93). Use os botões AXI / COR / SAG no visualizador para alternar o plano e depois deslize o controle para percorrer os cortes.',
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
    ].join('\n');
    document.head.appendChild(s);
  }

  function pauloLi(s) { return '<li>' + s + '</li>'; }

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
        switchView('axi');
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

    var examsHtml = PAULO_STUDIES.map(buildPauloExamSection).join('');

    var imagery =
      '<section class="report-section" id="imagery">' +
        '<div class="container">' +
          '<div class="section-label">' +
            t('09A · Imagery', '09A · Imagem') +
          '</div>' +
          '<h2 class="section-title">' +
            t('Imaging exams', 'Exames de imagem') +
          '</h2>' +
          '<p class="section-desc">' +
            t('Two imaging studies acquired the same day — cervical and lumbar MRI. Each viewer supports plane switching (AXI / COR / SAG), slider, mouse-wheel scroll, click-and-drag, and arrow-key navigation. The radiologist&apos;s report follows beneath each viewer in both Portuguese and English.',
              'Dois estudos de imagem realizados no mesmo dia — RM cervical e lombar. Cada visualizador aceita troca de plano (AXI / COR / SAG), controle deslizante, rolagem do mouse, clicar-e-arrastar e setas do teclado. O laudo do radiologista segue abaixo de cada visualizador, em português e em inglês.') +
          '</p>' +
        '</div>' +
        examsHtml +
      '</section>';

    var main = document.createElement('main');
    main.className = 'jc-paulo-exams';
    main.innerHTML = hero + imagery;
    document.body.appendChild(main);

    // Wire viewers
    PAULO_STUDIES.forEach(function (study) {
      var viewerEl = main.querySelector('.pl-ct-viewer[data-paulo-study="' + study.slug + '"]');
      if (viewerEl) wirePauloViewer(viewerEl, study);
    });

    // Place the danger zone beneath the new main, mirroring how the
    // jc-overview view does it for other patients.
    injectDangerZone(main);
  }
})();

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

  var PATIENT_ZERO = 'pending:joao';

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
      if (el.tagName === 'NAV' || el.tagName === 'HEADER' || el.tagName === 'SCRIPT' ||
          el.classList.contains('jc-empty-shell') ||
          el.classList.contains('jc-overview') ||
          el.classList.contains('jc-exams') ||
          el.classList.contains('jc-home')) continue;
      el.style.display = 'none';
    }
  }

  // ─── Renderers ──────────────────────────────────────────────────
  function renderPatientHeader(p) {
    var profileBits = [];
    if (p.date_of_birth) profileBits.push('DOB ' + formatDate(p.date_of_birth));
    if (p.sex) profileBits.push(escapeHtml(p.sex));
    if (p.country_of_residence) profileBits.push(escapeHtml(p.country_of_residence));
    if (p.native_language) profileBits.push('lang: ' + escapeHtml(p.native_language));
    return (
      '<header class="ov-header">' +
        '<div class="ov-eyebrow">Patient record</div>' +
        '<h1 class="ov-title">' + escapeHtml(p.full_name || 'Unnamed') + '</h1>' +
        '<div class="ov-profile">' + (profileBits.join(' · ') || '<em>No profile fields set.</em>') + '</div>' +
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
    return (
      '<div class="ov-pending">' +
        '<strong>' + pending.length + ' file' + (pending.length === 1 ? '' : 's') + ' did not process.</strong> ' +
        'Uploaded but classification or parsing failed (often an API billing or transient error). ' +
        '<ul class="ov-list">' +
          pending.map(function (f) {
            return '<li>' +
              '<span class="ov-list-title">' + escapeHtml(f.original_path || '(no name)') + '</span>' +
              '<span class="ov-list-meta">' + escapeHtml(f.status || '?') +
                (f.error_message ? ' — ' + escapeHtml(String(f.error_message).slice(0, 160)) : '') +
              '</span></li>';
          }).join('') +
        '</ul>' +
      '</div>'
    );
  }

  function renderDocList(docs) {
    if (!docs || docs.length === 0) return '<div class="ov-empty">No documents yet.</div>';
    return '<ul class="ov-list">' + docs.map(function (d) {
      var title = d.title || d.original_filename || '(untitled)';
      var date = d.document_date || (d.created_at && String(d.created_at).slice(0, 10));
      return '<li>' +
               '<span class="ov-list-title">' + escapeHtml(title) + '</span>' +
               '<span class="ov-list-meta">' +
                 escapeHtml(d.kind || '—') + ' · ' + escapeHtml(formatDate(date)) +
               '</span>' +
             '</li>';
    }).join('') + '</ul>';
  }

  function renderLabList(labs) {
    if (!labs || labs.length === 0) return '<div class="ov-empty">No lab results yet.</div>';
    return '<ul class="ov-list">' + labs.map(function (l) {
      var v = (l.value != null) ? (l.value + (l.unit ? ' ' + l.unit : '')) : (l.value_text || '—');
      var ref = (l.ref_low != null || l.ref_high != null)
        ? ' (ref ' + (l.ref_low != null ? l.ref_low : '–') + '–' + (l.ref_high != null ? l.ref_high : '–') + ')' : '';
      return '<li>' +
               '<span class="ov-list-title">' + escapeHtml(l.marker || '—') + fmtFlag(l.flag) + '</span>' +
               '<span class="ov-list-meta">' +
                 escapeHtml(v) + escapeHtml(ref) + ' · ' + escapeHtml(formatDate(l.taken_at)) +
                 (l.panel ? ' · ' + escapeHtml(l.panel) : '') +
               '</span>' +
             '</li>';
    }).join('') + '</ul>';
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

  function renderExams(exams) {
    var p = exams.patient || {};
    var panels = exams.panels || [];
    var docs = exams.lab_documents || [];
    var imaging = exams.imaging || [];

    var panelsHtml = panels.length === 0
      ? '<div class="ov-empty">No lab results yet. Upload exam PDFs from Add data; once parsed they appear here grouped by panel.</div>'
      : panels.map(function (pn) {
          var rows = pn.markers.map(function (m) {
            var v = (m.latest_value != null) ? (m.latest_value + (m.unit ? ' ' + m.unit : '')) : (m.latest_value_text || '—');
            var ref = (m.ref_low != null || m.ref_high != null)
              ? (m.ref_low != null ? m.ref_low : '–') + ' – ' + (m.ref_high != null ? m.ref_high : '–')
              : '—';
            var pointsCount = m.points && m.points.length;
            var pointsCell = pointsCount > 1
              ? '<span title="' + pointsCount + ' data points" class="exam-points">' + pointsCount + '×</span>'
              : '';
            return '<tr>' +
              '<td class="exam-marker">' + escapeHtml(m.marker) + '</td>' +
              '<td class="exam-value">' + escapeHtml(String(v)) + fmtFlag(m.flag) + '</td>' +
              '<td class="exam-ref">' + escapeHtml(ref) + '</td>' +
              '<td class="exam-date">' + escapeHtml(formatDate(m.latest_taken_at)) + '</td>' +
              '<td class="exam-lab">' + escapeHtml(m.laboratory || '—') + '</td>' +
              '<td class="exam-trend">' + pointsCell + '</td>' +
            '</tr>';
          }).join('');
          return (
            '<section class="exam-panel">' +
              '<header class="exam-panel-head">' +
                '<h2>' + escapeHtml(pn.panel) + '</h2>' +
                '<span class="exam-panel-count">' + pn.markers.length + ' marker' + (pn.markers.length === 1 ? '' : 's') + '</span>' +
              '</header>' +
              '<table class="exam-table">' +
                '<thead><tr>' +
                  '<th>Marker</th><th>Latest value</th><th>Ref range</th><th>Date</th><th>Lab</th><th>Points</th>' +
                '</tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
              '</table>' +
            '</section>'
          );
        }).join('');

    var imagingHtml = imaging.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>Imaging studies <span class="ov-count-inline">' + imaging.length + '</span></h2>' +
        '<ul class="ov-list">' + imaging.map(function (s) {
          return '<li>' +
            '<span class="ov-list-title">' + escapeHtml(s.modality || '?') +
              (s.body_part ? ' · ' + escapeHtml(s.body_part) : '') + '</span>' +
            '<span class="ov-list-meta">' + escapeHtml(formatDate(s.study_date)) +
              (s.file_count ? ' · ' + s.file_count + ' files' : '') +
              ' · ' + escapeHtml(s.source_format || '—') +
            '</span></li>';
        }).join('') + '</ul>' +
      '</section>';

    var docsHtml = docs.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>Source PDFs <span class="ov-count-inline">' + docs.length + '</span></h2>' +
        '<p class="ov-section-note">PDFs uploaded to this patient. Items marked "unclassified" landed here because the LLM classifier was unreachable when they were ingested.</p>' +
        renderDocList(docs) +
      '</section>';

    var view = document.createElement('main');
    view.className = 'jc-overview jc-exams';
    view.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        '<div class="ov-section-eyebrow">Physical → Exams</div>' +
        panelsHtml +
        imagingHtml +
        docsHtml +
      '</div>';
    document.body.appendChild(view);
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
          var inner =
            '<div class="ov-metric-num">' + escapeHtml(String(r.value)) + '</div>' +
            '<div class="ov-metric-label">' + escapeHtml(r.label) + '</div>';
          return r.href
            ? '<a class="ov-metric ov-metric-link" href="' + r.href + '">' + inner + '</a>'
            : '<div class="ov-metric">' + inner + '</div>';
        }).join('') + '</div>' +
      '</section>'
    );
  }

  function renderSectionView(opts) {
    /* opts: { summary, title, eyebrow, metrics, emptyHint } */
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
        '<div class="ov-section-eyebrow">' + escapeHtml(opts.eyebrow) + '</div>' +
        renderMetricGrid(opts.metrics) +
        (anyValue ? '' :
          '<div class="ov-section ov-empty-hint">' +
            '<p>' + escapeHtml(opts.emptyHint) + '</p>' +
          '</div>') +
        (opts.extra || '') +
      '</div>';
    document.body.appendChild(view);
  }

  function renderPhysical(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    var labs = summary.recent_labs || [];
    var docs = (summary.recent_documents || []).filter(function (d) {
      return ['lab_pdf', 'imaging_image', 'dicom_series', 'ecg_pdf', 'doctor_report', 'medication_csv', 'genetics_report'].indexOf(d.kind) !== -1;
    });
    var metrics = [
      { label: 'Lab markers',     value: b.lab_results     || 0, href: 'physical-exams.html' },
      { label: 'Imaging studies', value: b.imaging_studies || 0, href: 'physical-exams.html' },
      { label: 'Vitals days',     value: b.vitals_days     || 0, href: 'physical-vitals.html' },
      { label: 'ECG events',      value: b.ecg_events      || 0, href: 'physical-vitals.html' },
      { label: 'Genetics (PGx)',  value: b.pgx_findings    || 0, href: 'physical-genetics.html' },
      { label: 'Medications',     value: b.medications     || 0 },
      { label: 'Supplements',     value: b.supplements     || 0 },
      { label: 'Encounters',      value: b.encounters      || 0 },
      { label: 'Surgeries',       value: b.surgeries       || 0 },
      { label: 'Injuries',        value: b.injuries        || 0 },
    ];
    var extra =
      (labs.length === 0 ? '' :
        '<section class="ov-section">' +
          '<h2>Recent lab results <span class="ov-count-inline">' + labs.length + '</span></h2>' +
          renderLabList(labs.slice(0, 8)) +
        '</section>') +
      (docs.length === 0 ? '' :
        '<section class="ov-section">' +
          '<h2>Recent documents <span class="ov-count-inline">' + docs.length + '</span></h2>' +
          renderDocList(docs.slice(0, 8)) +
        '</section>');
    renderSectionView({
      summary: summary, title: 'Physical', eyebrow: 'Physical',
      metrics: metrics, extra: extra,
      emptyHint: 'Nothing physical ingested yet. Drop lab PDFs, ECGs, imaging or vitals exports from Add data.',
    });
  }

  function renderVitals(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Vitals', eyebrow: 'Physical → Vitals',
      metrics: [
        { label: 'Vitals days', value: b.vitals_days || 0 },
        { label: 'ECG events',  value: b.ecg_events  || 0 },
      ],
      emptyHint: 'No vitals data ingested yet. Drop CSV/JSON exports from Oura, Apple Health, Withings, Whoop, etc.',
    });
  }

  function renderGenetics(summary) {
    var b = (summary.pillars && summary.pillars.physical && summary.pillars.physical.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Genetics', eyebrow: 'Physical → Genetics',
      metrics: [
        { label: 'PGx findings', value: b.pgx_findings || 0 },
      ],
      emptyHint: 'No genetics data ingested yet. Upload a 23andMe / AncestryDNA raw file or a pharmacogenomic report PDF.',
    });
  }

  function renderMental(summary) {
    var b = (summary.pillars && summary.pillars.mental && summary.pillars.mental.breakdown) || {};
    var writings = (summary.recent_documents || []).filter(function (d) { return d.kind === 'writing'; });
    var extra = writings.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>Recent writings <span class="ov-count-inline">' + writings.length + '</span></h2>' +
        renderDocList(writings.slice(0, 8)) +
      '</section>';
    renderSectionView({
      summary: summary, title: 'Mental', eyebrow: 'Mental',
      metrics: [
        { label: 'Writings',         value: b.writings         || 0 },
        { label: 'Mood entries',     value: b.mood_entries     || 0 },
        { label: 'Psych items',      value: b.psych_items      || 0 },
        { label: 'Panic events',     value: b.panic_events     || 0 },
        { label: 'Risk assessments', value: b.risk_assessments || 0 },
      ],
      extra: extra,
      emptyHint: 'No mental-health data ingested yet. Drop journals, mood logs, or psych evaluations from Add data.',
    });
  }

  function renderSpiritual(summary) {
    var b = (summary.pillars && summary.pillars.spiritual && summary.pillars.spiritual.breakdown) || {};
    renderSectionView({
      summary: summary, title: 'Spiritual', eyebrow: 'Spiritual',
      metrics: [
        { label: 'Wheel of life',  value: b.wheel_of_life || 0 },
        { label: 'Life events',    value: b.life_events   || 0 },
      ],
      emptyHint: 'No spiritual data ingested yet. Drop wheel-of-life self-assessments or life-event CSVs from Add data.',
    });
  }

  function renderEmptyShell(clerkId, patientName, sectionLabel) {
    var shell = document.createElement('main');
    shell.className = 'jc-empty-shell';
    shell.innerHTML =
      '<div class="jc-empty-card">' +
        '<div class="jc-empty-eyebrow">' + escapeHtml(sectionLabel || 'Patient record') + '</div>' +
        '<h1 class="jc-empty-title">' +
          'Not built yet for ' + escapeHtml(patientName || 'this patient') + '.' +
        '</h1>' +
        '<p class="jc-empty-body">' +
          'This section still uses Patient Zero\'s hardcoded layout. Data for ' +
          escapeHtml(patientName || 'this patient') + ' will appear here once a data-driven view is built.' +
        '</p>' +
        '<div class="jc-empty-id">' + escapeHtml(clerkId) + '</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">' +
          '<a href="home.html" class="jc-empty-back" style="text-decoration:none;display:inline-block;">← Back to summary</a>' +
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

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    injectChangeButton();
    if (patient === PATIENT_ZERO) return;

    injectStyles();
    hidePageBody();

    var section = currentSection();

    if (section === 'home') {
      fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (s) { renderHome(s); decorateWithDashboard('home', { isHome: true }); })
        .catch(function () { renderEmptyShell(patient, null, 'Patient record'); });
      return;
    }

    if (section === 'physical-exams') {
      fetch('/api/patient-exams?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (e) { renderExams(e); decorateWithDashboard('physical'); })
        .catch(function () { renderEmptyShell(patient, null, 'Physical → Exams'); });
      return;
    }

    // Other section pages — show a small "not built yet" shell rather than the
    // home overview, so the user knows where they are.
    var labels = {
      'physical':          'Physical',
      'physical-vitals':   'Physical → Vitals',
      'physical-genetics': 'Physical → Genetics',
      'mental':            'Mental',
      'spiritual':         'Spiritual',
      'loops':             'Loops',
      'assessment':        'Assessment',
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
        else renderEmptyShell(patient, summary.patient && summary.patient.full_name, labels[section] || section);
      })
      .catch(function () { renderEmptyShell(patient, null, labels[section] || section); });
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
    home: 'Home', physical: 'Physical', mental: 'Mental',
    spiritual: 'Spiritual', assessment: 'Assessment',
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
    var t = new Date(iso).getTime();
    var secs = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (secs < 60)         return secs + 's ago';
    if (secs < 3600)       return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400)      return Math.floor(secs / 3600) + 'h ago';
    if (secs < 86400 * 30) return Math.floor(secs / 86400) + 'd ago';
    return formatDate(iso);
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
    var rows = (c.markers || []).map(function (m) {
      return '<tr>' +
        '<td class="exam-marker">' + escapeHtml(m.marker || '—') + '</td>' +
        '<td class="exam-value">' + escapeHtml(String(valueWithUnit(m.value, m.value_text, m.unit))) + fmtFlag(m.flag) + '</td>' +
        '<td class="exam-ref">' + escapeHtml(refRangeStr(m.ref_low, m.ref_high)) + '</td>' +
      '</tr>';
    }).join('');
    return (
      '<section class="ov-card ov-card-panel">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
        '<table class="exam-table"><thead><tr>' +
          '<th>Marker</th><th>Value</th><th>Ref range</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</section>'
    );
  }

  function renderCardMarkerTimeline(c) {
    var points = (c.points || []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    var unit = c.unit ? ' ' + c.unit : '';
    var rows = points.map(function (p) {
      var flagged = p.flag ? fmtFlag(p.flag) : '';
      return '<tr>' +
        '<td class="exam-date">' + escapeHtml(formatDate(p.date)) + '</td>' +
        '<td class="exam-value">' + escapeHtml(fmtNum(p.value)) + escapeHtml(unit) + flagged + '</td>' +
        '<td class="exam-lab">' + escapeHtml(p.lab || '—') + '</td>' +
      '</tr>';
    }).join('');
    var ref = refRangeStr(c.ref_low, c.ref_high);
    var refLine = (ref !== '—' ? '<div class="ov-card-subtitle">Reference: ' + escapeHtml(ref) + (c.unit ? ' ' + escapeHtml(c.unit) : '') + '</div>' : '');
    return (
      '<section class="ov-card ov-card-timeline">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
          refLine +
        '</header>' +
        '<table class="exam-table"><thead><tr>' +
          '<th>Date</th><th>Value</th><th>Lab</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</section>'
    );
  }

  function renderCardFlagList(c) {
    var rows = (c.items || []).map(function (it) {
      return '<tr>' +
        '<td class="exam-marker">' + escapeHtml(it.marker || '—') + fmtFlag(it.flag) + '</td>' +
        '<td class="exam-value">' + escapeHtml(String(valueWithUnit(it.value, it.value_text, it.unit))) + '</td>' +
        '<td class="exam-ref">' + escapeHtml(refRangeStr(it.ref_low, it.ref_high)) + '</td>' +
        '<td class="exam-date">' + escapeHtml(formatDate(it.date)) + '</td>' +
        '<td class="exam-lab">' + escapeHtml(it.panel || '—') + '</td>' +
      '</tr>';
    }).join('');
    return (
      '<section class="ov-card ov-card-flags">' +
        '<header class="ov-card-head"><h3>' + escapeHtml(c.title) + '</h3>' +
          (c.subtitle ? '<div class="ov-card-subtitle">' + escapeHtml(c.subtitle) + '</div>' : '') +
        '</header>' +
        '<table class="exam-table"><thead><tr>' +
          '<th>Marker</th><th>Value</th><th>Ref range</th><th>Date</th><th>Panel</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '</section>'
    );
  }

  var CARD_RENDERERS = {
    'narrative':       renderCardNarrative,
    'panel-snapshot':  renderCardPanelSnapshot,
    'marker-timeline': renderCardMarkerTimeline,
    'flag-list':       renderCardFlagList,
  };

  function dashboardCardHtml(dashSection, record, opts) {
    opts = opts || {};
    var isHome = !!opts.isHome;
    var titleEn = isHome ? 'AI-authored summary' : (SECTION_LABEL[dashSection] + ' · AI-authored');
    var cards = (record && Array.isArray(record.cards)) ? record.cards : [];
    var hasCards = cards.length > 0;
    var meta = (record && record.generated_at)
      ? '<div class="ov-dashboard-meta">Generated ' + relativeWhen(record.generated_at) +
          (record.model ? ' · <code>' + escapeHtml(record.model) + '</code>' : '') +
          ' · ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '</div>'
      : '';
    var refreshLabel = hasCards ? 'Refresh' : 'Build cards';
    var allBtn = isHome
      ? '<button type="button" class="btn btn-gold dash-build-all-btn" data-sections="' +
        DASHBOARD_SECTIONS.join(',') + '">Build all sections</button>'
      : '';
    var cardsHtml = hasCards
      ? cards.map(function (c) {
          var fn = CARD_RENDERERS[c.kind];
          return fn ? fn(c) : '';
        }).join('')
      : '<section class="ov-card ov-card-empty">' +
          '<p>No AI-authored cards yet for this section. Click <strong>' + escapeHtml(refreshLabel) +
          '</strong> to have Claude read the patient\'s data and propose a card layout tailored to it.</p>' +
        '</section>';
    return (
      '<div class="ov-cards" data-dash-section="' + escapeHtml(dashSection) + '">' +
        '<header class="ov-cards-head">' +
          '<div class="ov-cards-head-left">' +
            '<h2>' + escapeHtml(titleEn) + ' <span class="ai-pill">AI</span></h2>' + meta +
          '</div>' +
          '<div class="ov-cards-head-actions">' + allBtn +
            '<button type="button" class="btn btn-ghost dash-build-btn" data-section="' + escapeHtml(dashSection) + '">' +
              escapeHtml(refreshLabel) + '</button>' +
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
    var target = findInsertionTarget(opts);
    if (!target) return;
    // Remove any prior dashboard card for this section (defensive)
    var prior = target.querySelector('[data-dash-section="' + dashSection + '"]');
    if (prior) prior.remove();
    var html = dashboardCardHtml(dashSection, record, opts);
    if (opts && opts.isHome) {
      target.insertAdjacentHTML('beforeend', html);
    } else {
      var header = target.querySelector('.ov-header');
      if (header) header.insertAdjacentHTML('afterend', html);
      else target.insertAdjacentHTML('afterbegin', html);
    }
    wireDashboardButtons();
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
          '<div class="jc-donut-label">Building…</div>' +
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
    el.querySelector('.jc-donut-label').textContent = label || 'Building…';
    var pct = total > 0 ? done / total : 0;
    var dashLen = 263.9;
    el.querySelector('.jc-donut-fg').setAttribute('stroke-dashoffset', String(dashLen * (1 - pct)));
  }
  function pushDonutTrail(section, status, ms) {
    var trail = (donutEl && donutEl.querySelector('.jc-donut-trail'));
    if (!trail) return;
    var li = document.createElement('li');
    li.className = 'jc-donut-trail-item ' + status;
    li.textContent = (status === 'ok' ? '✓ ' : '✗ ') + (SECTION_LABEL[section] || section) +
                     (typeof ms === 'number' ? ' · ' + (ms/1000).toFixed(1) + 's' : '');
    trail.appendChild(li);
  }
  function closeDonut() { if (donutEl) donutEl.classList.remove('open'); }

  async function buildSections(sections) {
    sections = (sections || []).filter(function (s) { return DASHBOARD_SECTIONS.indexOf(s) !== -1; });
    if (sections.length === 0) return;
    var total = sections.length;
    setDonut(0, total, 'Starting…');
    var viewerClerk = viewerClerkHeader();
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      setDonut(i, total, 'Building ' + (SECTION_LABEL[section] || section) + '…');
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
            setDonut(i, total, 'Rate-limited, waiting 30s…');
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
    setDonut(total, total, 'Done. Reloading…');
    setTimeout(function () { location.reload(); }, 700);
  }
})();
